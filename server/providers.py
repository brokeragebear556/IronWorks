"""Metadata providers, in the spirit of Jellyfin's: each one looks up facts about a gun
or part from one source, and the user chooses what to apply.

- local_files:  saved product pages (.html) and PDFs in the scan folder
- product_page: a retailer or manufacturer URL, fetched on request
Price tracking reuses product_page to re-check prices on a schedule (see prices.py)."""
import hashlib
import ipaddress
import re
import socket
from pathlib import Path
from urllib.parse import urlparse

import httpx

from . import db, library, wikidata
from .config import CACHE, USER_AGENT
from .parsing import parse_product_html

PROVIDERS = {
    "local_files": {
        "name": "Local files",
        "description": "Reads saved product pages (.html) and PDFs in your scan folder. Works offline.",
    },
    "product_page": {
        "name": "Product page lookup",
        "description": "Fetches a retailer or manufacturer page you link to and reads its specs, price and photos.",
    },
    "wikidata": {
        "name": "Wikidata",
        "description": "Free, open facts about well-known gun models: maker, cartridge, length, weight, velocity, "
                       "capacity and a photo. No prices. Sends the gun's name to wikidata.org. Guns only, not parts.",
    },
}

MAX_PAGE = 8_000_000
_WORD = re.compile(r"[a-z0-9]+(?:\.[0-9]+)?")
STOP = {"the", "and", "with", "w", "for", "a", "of", "in", "black", "html", "pdf", "palmetto", "state", "armory", "psa"}


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(str(text).lower()) if w not in STOP and len(w) > 1}


def _similarity(a: str, b: str) -> float:
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / min(len(wa), len(wb))


# ---------- local files ----------
def scan_folder() -> Path:
    return Path(db.get_settings()["scanFolder"])


def list_local_files() -> list[Path]:
    folder = scan_folder()
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in {".html", ".htm", ".pdf"})


def _pdf_result(path: Path) -> dict:
    import pymupdf  # imported lazily; only needed for PDFs

    doc = pymupdf.open(path)
    title = (doc.metadata or {}).get("title") or path.stem
    digest = hashlib.sha1(str(path.resolve()).encode() + str(path.stat().st_mtime).encode()).hexdigest()[:16]
    out_dir = CACHE / "pdf" / digest
    images = []
    if not out_dir.is_dir():
        out_dir.mkdir(parents=True, exist_ok=True)
        n = 0
        for page_no in range(min(2, doc.page_count)):
            for img in doc[page_no].get_images(full=True):
                info = doc.extract_image(img[0])
                w, h = info["width"], info["height"]
                # product shots are big and roughly square-ish; skip banners and icons
                if w < 300 or h < 250 or w / max(h, 1) > 3.2:
                    continue
                n += 1
                (out_dir / f"{n:02d}.{info['ext']}").write_bytes(info["image"])
    images = [f"/api/cache/pdf/{digest}/{p.name}" for p in sorted(out_dir.iterdir()) if p.is_file()]
    return {"name": title, "brand": None, "sku": None, "price": None, "currency": None, "inStock": None,
            "images": images, "specs": {}, "specLines": [], "url": None}


def parse_local(path: Path) -> dict:
    if path.suffix.lower() == ".pdf":
        return _pdf_result(path)
    html = path.read_text(encoding="utf-8", errors="replace")
    return parse_product_html(html)


def local_matches(item: dict) -> list[tuple[Path, float]]:
    sources = {s.lower() for s in item.get("sources", [])}
    name = f"{item.get('name', '')} {item.get('short', '')}"
    found = []
    for p in list_local_files():
        if p.name.lower() in sources:
            found.append((p, 1.0))
            continue
        score = _similarity(name, p.stem)
        if score >= 0.5:
            found.append((p, round(score, 2)))
    found.sort(key=lambda t: -t[1])
    return found[:6]


def run_local(item: dict) -> list[dict]:
    results = []
    for path, score in local_matches(item):
        try:
            data = parse_local(path)
        except Exception as e:
            results.append({"provider": "local_files", "source": path.name, "confidence": score, "error": str(e)})
            continue
        results.append({"provider": "local_files", "source": path.name, "confidence": score, "data": data})
    return results


def unmatched_files(guns: list[dict]) -> list[str]:
    used = set()
    for g in guns:
        used |= {s.lower() for s in g.get("sources", [])}
        for p in g.get("parts", []):
            used |= {s.lower() for s in p.get("sources", [])}
    return [p.name for p in list_local_files() if p.name.lower() not in used]


# ---------- product page ----------
class FetchError(ValueError):
    pass


def _check_url(url: str) -> str:
    u = urlparse(url.strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise FetchError("Use a full web address starting with https://")
    try:
        infos = socket.getaddrinfo(u.hostname, None)
    except socket.gaierror:
        raise FetchError(f"Couldn't find the site {u.hostname}.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise FetchError("Addresses on this computer or your home network can't be looked up.")
    return url.strip()


def fetch_page(url: str) -> dict:
    url = _check_url(url)
    try:
        with httpx.Client(follow_redirects=True, timeout=20, headers={"User-Agent": USER_AGENT, "Accept": "text/html"}) as c:
            r = c.get(url)
    except httpx.HTTPError as e:
        raise FetchError(f"Couldn't reach the page: {e.__class__.__name__}.")
    if r.status_code in (401, 403, 429, 503):
        raise FetchError(f"The site refused the request ({r.status_code}). Save the page from your browser into the scan folder instead.")
    if r.status_code >= 400:
        raise FetchError(f"The page returned an error ({r.status_code}).")
    if len(r.content) > MAX_PAGE:
        raise FetchError("That page is too large to read.")
    data = parse_product_html(r.text, str(r.url))
    data["url"] = data.get("url") or str(r.url)
    return data


def run_product_page(item: dict, extra_url: str | None) -> list[dict]:
    urls = [l["url"] for l in item.get("links", []) if l.get("url")]
    if extra_url:
        urls.insert(0, extra_url)
    results, seen = [], set()
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        try:
            results.append({"provider": "product_page", "source": url, "confidence": 1.0, "data": fetch_page(url)})
        except FetchError as e:
            results.append({"provider": "product_page", "source": url, "confidence": 1.0, "error": str(e)})
    return results


# ---------- wikidata ----------
def run_wikidata(key: str, item: dict) -> list[dict]:
    if "/" in key:  # parts and attachments: Wikidata covers gun models, not accessories
        return []
    name = item.get("name") or ""
    try:
        return wikidata.lookup(name, _similarity, db.get_settings().get("wikidataContact") or "")
    except (wikidata.WikidataError, ValueError) as e:
        return [{"provider": "wikidata", "source": "wikidata.org", "confidence": 0, "error": str(e)}]


# ---------- orchestration ----------
def identify(key: str, url: str | None = None) -> list[dict]:
    item = library.get_item(key)
    enabled = [p["id"] for p in db.get_settings()["providers"] if p.get("enabled")]
    results: list[dict] = []
    for pid in enabled:
        if pid == "local_files":
            results += run_local(item)
        elif pid == "product_page":
            results += run_product_page(item, url)
        elif pid == "wikidata":
            results += run_wikidata(key, item)
    if url and "product_page" not in enabled:
        results += run_product_page(item, url)
    stamp = db.now()
    import json

    with db.tx() as c:
        for r in results:
            cur = c.execute("INSERT INTO metadata(item_key, provider, source, fetched_at, data) VALUES(?,?,?,?,?)",
                            (key, r["provider"], r["source"], stamp, json.dumps(r)))
            r["id"] = cur.lastrowid
            r["fetchedAt"] = stamp
    return results


def refresh(key: str) -> dict:
    """Jellyfin-style 'Refresh metadata': run the providers and save what is safe to save
    without asking: the latest price, and specs, brand and SKU the item doesn't have yet.
    Nothing the user already set is overwritten (except the list price, which is meant to update)."""
    item = library.get_item(key)
    results = identify(key)
    # Wikidata describes a model, not your exact gun: only a close name match may fill in specs unasked
    good = [r for r in results if r.get("data") and (r["provider"] != "wikidata" or r.get("confidence", 0) >= 0.9)]
    no_contact = not db.get_settings().get("wikidataContact")  # not set up yet: don't nag on every refresh
    errors = [f"{r['source']}: {r['error']}" for r in results if r.get("error") and not (no_contact and r["provider"] == "wikidata")]
    # live product pages are more current than saved files
    good.sort(key=lambda r: (r["provider"] != "product_page", -r.get("confidence", 0)))
    specs = dict(item.get("specs") or {})
    added: list[str] = []
    old_price = specs.get("listPrice")
    price_from = None
    # A gun built from separately bought pieces: each saved page is the price of one piece,
    # not of the whole gun, so update the matching component instead of the gun's list price.
    components = [dict(c) for c in (item.get("components") or [])]
    comp_changed = False
    if components:
        for r in good:
            for c in components:
                if c.get("source") and c["source"].lower() == r["source"].lower() and r["data"].get("price") is not None:
                    if c.get("listPrice") != r["data"]["price"]:
                        c["listPrice"] = r["data"]["price"]
                        c["listPriceDate"] = r["fetchedAt"][:10]
                        comp_changed = True
        good_for_price: list[dict] = []
    else:
        good_for_price = good
    for r in good_for_price:
        d = r["data"]
        if price_from is None and d.get("price") is not None:
            specs["listPrice"] = d["price"]
            specs["listPriceDate"] = r["fetchedAt"][:10]
            price_from = r["source"]
    for r in good:
        d = r["data"]
        for k in ("brand", "sku"):
            if d.get(k) and not specs.get(k):
                specs[k] = str(d[k])
                added.append(k)
        for k, v in (d.get("specs") or {}).items():
            if v and not specs.get(k):
                specs[k] = v
                added.append(k)
    if added or price_from is not None:
        library.update_item(key, {"specs": specs})
    if comp_changed:
        library.update_item(key, {"components": components})
    return {
        "key": key,
        "name": item.get("name"),
        "sources": len(good),
        "price": None if components else specs.get("listPrice"),
        "oldPrice": None if components else old_price,
        "componentsUpdated": comp_changed,
        "priceFrom": price_from,
        "specsAdded": added,
        "errors": errors,
    }


def refresh_all() -> list[dict]:
    out = []
    for g in library.list_guns()["guns"]:
        for key in [g["id"]] + [f"{g['id']}/{p['id']}" for p in g["parts"]]:
            try:
                out.append(refresh(key))
            except Exception as e:  # keep going; report per item
                out.append({"key": key, "name": key, "sources": 0, "price": None, "oldPrice": None,
                            "priceFrom": None, "specsAdded": [], "errors": [str(e)]})
    return out


UPLOAD_EXT = {".html", ".htm", ".pdf"}


def identify_upload(key: str, filename: str, data: bytes) -> list[dict]:
    """A product page the user saved from their own browser (Ctrl+S) or a PDF, uploaded on the
    Metadata tab. Many stores refuse automated requests, so this is the dependable way in. The file is
    kept in the scan folder, so Refresh metadata finds it again later."""
    import json
    import re

    library.get_item(key)  # check it exists
    ext = Path(filename).suffix.lower()
    if ext not in UPLOAD_EXT:
        raise FetchError("Upload a saved web page (.html) or a PDF.")
    if not data:
        raise FetchError("That file is empty.")
    stem = re.sub(r"[^\w .,()&+-]+", "_", Path(filename).stem).strip(" ._")[:120] or "page"
    folder = Path(db.get_settings()["scanFolder"])
    if not folder.is_dir():
        raise FetchError("The scan folder in Settings → Library scan doesn't exist.")
    path = folder / f"{stem}{ext}"
    n = 2
    while path.exists() and path.read_bytes() != data:
        path = folder / f"{stem} ({n}){ext}"
        n += 1
    path.write_bytes(data)
    try:
        result = {"provider": "local_files", "source": path.name, "confidence": 1.0, "data": parse_local(path)}
    except Exception as e:  # unreadable page: report it, keep the file for the user to check
        result = {"provider": "local_files", "source": path.name, "confidence": 1.0, "error": f"Couldn't read that file: {e}"}
    stamp = db.now()
    with db.tx() as c:
        cur = c.execute("INSERT INTO metadata(item_key, provider, source, fetched_at, data) VALUES(?,?,?,?,?)",
                        (key, result["provider"], result["source"], stamp, json.dumps(result)))
        result["id"], result["fetchedAt"] = cur.lastrowid, stamp
    return [result]


def history(key: str) -> list[dict]:
    import json

    out = []
    for row in db.rows("SELECT id, data, fetched_at FROM metadata WHERE item_key=? ORDER BY id DESC LIMIT 30", (key,)):
        r = json.loads(row["data"])
        r["id"], r["fetchedAt"] = row["id"], row["fetched_at"]
        out.append(r)
    return out
