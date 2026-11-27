"""Wikidata: free, open facts about well-known firearm models (maker, cartridge, length, weight,
muzzle velocity, capacity, country, year, a photo). It has no prices, and coverage is patchy:
common models such as the Glock 17 or the M&P15-22 are there, most custom builds are not.

Only the gun's name is sent, and only when a lookup or refresh runs. Wikimedia limits how fast
clients may ask, so answers are cached for a day and requests are spaced out."""
import re
import threading
import time

import httpx

API = "https://www.wikidata.org/w/api.php"
SPARQL = "https://query.wikidata.org/sparql"
# Wikimedia's User-Agent policy: name the client and give a way to reach whoever runs it.
# Without a contact Wikidata answers 403, so the user adds theirs in Settings.
def user_agent(contact: str) -> str:
    return f"Ironworks/2.0 ({contact}; self-hosted gun collection app) httpx/{httpx.__version__}"
FIREARM, FIREARM_MODEL = "Q12796", "Q22704163"
GUNNY = re.compile(r"pistol|rifle|carbine|shotgun|firearm|revolver|gun|submachine|handgun", re.I)
TTL = 24 * 3600
GAP = 1.0  # seconds between requests to Wikimedia

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()
_last = 0.0


class WikidataError(Exception):
    pass


def _get(url: str, params: dict, contact: str) -> dict:
    global _last
    key = url + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]  # type: ignore[return-value]
    with _lock:
        wait = GAP - (time.time() - _last)
        if wait > 0:
            time.sleep(wait)
        try:
            with httpx.Client(timeout=25, headers={"User-Agent": user_agent(contact), "Accept": "application/json"}) as c:
                r = c.get(url, params=params)
        except httpx.HTTPError as e:
            raise WikidataError(f"Couldn't reach Wikidata: {e.__class__.__name__}.")
        finally:
            _last = time.time()
    if r.status_code == 429:
        raise WikidataError("Wikidata is busy (too many requests). Try again in a minute.")
    if r.status_code == 403:
        raise WikidataError("Wikidata refused the request (403). Check the contact under Settings → Metadata providers.")
    if r.status_code >= 400:
        raise WikidataError(f"Wikidata returned an error ({r.status_code}).")
    data = r.json()
    _cache[key] = (time.time(), data)
    return data


def _queries(name: str) -> list[str]:
    """The full name, then shorter forms: 'Glock 17 Gen5 MOS' -> 'Glock 17 Gen5' -> 'Glock 17'."""
    words = name.replace("(", " ").replace(")", " ").split()
    out = []
    for n in range(len(words), 1 if len(words) > 1 else 0, -1):
        q = " ".join(words[:n])
        if q not in out:
            out.append(q)
    return out[:4]


def candidates(name: str, contact: str) -> list[str]:
    """Wikidata items whose label matches the name, preferring ones described as a gun."""
    ids: list[str] = []
    for q in _queries(name):
        res = _get(API, {"action": "wbsearchentities", "search": q, "language": "en", "type": "item", "limit": "7", "format": "json"}, contact)
        hits = res.get("search", [])
        gunny = [h["id"] for h in hits if GUNNY.search(h.get("description", "") or "")]
        for i in gunny + [h["id"] for h in hits][:2]:
            if i not in ids:
                ids.append(i)
        if gunny:
            break
    return ids[:8]


QUERY = """
SELECT ?item ?itemLabel ?itemDescription ?mfrLabel ?brandLabel ?ammoLabel ?len ?hgt ?mass ?mv ?cal ?rof ?cap ?countryLabel ?inception ?img WHERE {
  VALUES ?item { %s }
  FILTER(EXISTS { ?item wdt:P31 wd:%s } || EXISTS { ?item wdt:P279+ wd:%s } || EXISTS { ?item wdt:P31/wdt:P279* wd:%s })
  OPTIONAL { ?item wdt:P176 ?mfr } OPTIONAL { ?item wdt:P1716 ?brand } OPTIONAL { ?item wdt:P739 ?ammo }
  OPTIONAL { ?item p:P2043/psn:P2043/wikibase:quantityAmount ?len } OPTIONAL { ?item p:P2048/psn:P2048/wikibase:quantityAmount ?hgt }
  OPTIONAL { ?item p:P2067/psn:P2067/wikibase:quantityAmount ?mass } OPTIONAL { ?item p:P4137/psn:P4137/wikibase:quantityAmount ?mv }
  OPTIONAL { ?item p:P4403/psn:P4403/wikibase:quantityAmount ?cal } OPTIONAL { ?item wdt:P3792 ?rof } OPTIONAL { ?item wdt:P13048 ?cap }
  OPTIONAL { ?item wdt:P495 ?country } OPTIONAL { ?item wdt:P571 ?inception } OPTIONAL { ?item wdt:P18 ?img }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
} LIMIT 600"""


def _num(v: float, places: int = 2) -> str:
    return f"{round(v, places):.{places}f}".rstrip("0").rstrip(".")


def firearms(ids: list[str], contact: str) -> dict[str, dict]:
    """Facts for the items that are firearms, gathered from the query's rows."""
    if not ids:
        return {}
    q = QUERY % (" ".join(f"wd:{i}" for i in ids), FIREARM_MODEL, FIREARM, FIREARM)
    rows = _get(SPARQL, {"query": q, "format": "json"}, contact).get("results", {}).get("bindings", [])
    found: dict[str, dict[str, set]] = {}
    for b in rows:
        qid = b["item"]["value"].rsplit("/", 1)[-1]
        f = found.setdefault(qid, {})
        for k, v in b.items():
            f.setdefault(k, set()).add(v["value"])
    return {qid: _to_result(qid, f) for qid, f in found.items()}


def _one(f: dict[str, set], k: str) -> str | None:
    v = f.get(k)
    return next(iter(v)) if v and len(v) == 1 else None


def _first_float(f: dict[str, set], k: str) -> float | None:
    vals = sorted(float(x) for x in f.get(k, ()) if re.fullmatch(r"-?[\d.]+(e-?\d+)?", x))
    return vals[0] if vals else None


def _to_result(qid: str, f: dict[str, set]) -> dict:
    name = _one(f, "itemLabel") or qid
    specs: dict[str, str] = {}
    # a maker or brand only when there's exactly one (generic patterns like "AR-15-style rifle" list dozens)
    maker = _one(f, "mfrLabel")
    # brand names often include model nicknames ("Glock", "G17"): take the one the model is named with
    brands = sorted(f.get("brandLabel", ()), key=len)
    brand = next((b for b in brands if b.split()[0].lower() in name.lower()), None) or maker
    if maker:
        specs["manufacturer"] = maker
    ammo = f.get("ammoLabel")
    if ammo and len(ammo) <= 3:
        specs["caliber"] = " / ".join(sorted(ammo))
    elif (cal := _first_float(f, "cal")) is not None:
        specs["caliber"] = f"{_num(cal * 1000, 2)} mm"
    if (v := _first_float(f, "len")) is not None:
        specs["overallLength"] = f'{_num(v / 0.0254)}"'
    if (v := _first_float(f, "hgt")) is not None:
        specs["height"] = f'{_num(v / 0.0254)}"'
    if (v := _first_float(f, "mass")) is not None:
        lb = v * 2.2046226
        specs["weight"] = f"{_num(lb * 16, 1)} oz" if lb < 3 else f"{_num(lb)} lb"
    if (v := _first_float(f, "mv")) is not None:
        specs["muzzleVelocity"] = f"{round(v * 3.28084)} fps"
    if (v := _first_float(f, "rof")) is not None:
        specs["rateOfFire"] = f"{round(v)} rpm"
    caps = sorted({int(float(x)) for x in f.get("cap", ()) if re.fullmatch(r"[\d.]+", x)})
    if caps:
        specs["capacity"] = ", ".join(str(c) for c in caps[:4])
    if country := _one(f, "countryLabel"):
        specs["countryOfOrigin"] = country
    if inc := _one(f, "inception"):
        specs["introduced"] = inc[:4]
    images = sorted(u.replace("http://", "https://", 1) + "?width=1200" for u in f.get("img", ()))[:4]
    desc = _one(f, "itemDescription")
    return {"name": name, "brand": brand, "sku": None, "price": None, "currency": None, "inStock": None, "images": images, "specs": specs,
            "specLines": [["Description", desc]] if desc else [], "url": f"https://www.wikidata.org/wiki/{qid}"}


def lookup(name: str, similarity, contact: str) -> list[dict]:
    """Best matches for a gun's name, as provider results (at most three)."""
    if not contact:
        raise WikidataError("Add your email or web address under Settings → Metadata providers → Wikidata. "
                            "Wikidata refuses lookups from apps that don't give a contact.")
    ids = candidates(name, contact)
    found = firearms(ids, contact)
    out = []
    for qid, data in found.items():
        score = round(similarity(name, data["name"]), 2)
        if score < 0.5:
            continue
        out.append({"provider": "wikidata", "source": f"{data['name']} ({qid})", "confidence": min(score, 1.0), "data": data})
    out.sort(key=lambda r: (-r["confidence"], ids.index(r["source"].rsplit("(", 1)[-1].rstrip(")"))))
    return out[:3]
