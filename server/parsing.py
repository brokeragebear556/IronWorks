"""Pulls product facts out of a retailer or manufacturer page: name, brand, SKU, price,
stock, photos and a spec list. Works on schema.org JSON-LD, OpenGraph tags, Magento
spec tables and the common 'Label: value' lists in product descriptions."""
import json
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

# Canonical spec names, matched against whatever label a site uses.
SPEC_KEYS = [
    ("brand", r"^(brand|manufacturer|maker)$"),
    ("caliber", r"^(caliber|calibre|chamber(ing)?|cartridge|caliber\s*/\s*gauge)$"),
    ("barrelLength", r"^barrel\s*length$"),
    ("barrel", r"^barrel(\s*(description|material|steel|profile))?$"),
    ("twist", r"^(twist|twist\s*rate|rifling)$"),
    ("gasSystem", r"^gas\s*(system)?(\s*length)?$"),
    ("gasBlock", r"^gas\s*block(\s*type)?$"),
    ("muzzle", r"^muzzle(\s*device)?$"),
    ("thread", r"^(muzzle\s*)?thread(s|\s*pitch)?$"),
    ("handguard", r"^(hand\s*guard|handguard|rail)(\s*type|\s*length)?$"),
    ("bcg", r"^(bolt\s*carrier(\s*group)?|bcg|bolt)$"),
    ("chargingHandle", r"^charging\s*handle$"),
    ("trigger", r"^trigger$"),
    ("safety", r"^safety$"),
    ("stock", r"^stock(\s*description)?$"),
    ("grip", r"^(pistol\s*)?grips?$"),
    ("bufferTube", r"^buffer\s*tube$"),
    ("buffer", r"^buffer$"),
    ("bufferSpring", r"^buffer\s*spring$"),
    ("finish", r"^(finish|receiver\s*finish|color)$"),
    ("material", r"^(receiver\s*)?material$"),
    ("capacity", r"^capacity$"),
    ("weight", r"^weight$"),
    ("overallLength", r"^(oal|overall\s*length)$"),
    ("sights", r"^sights?$"),
    ("action", r"^action$"),
    ("platform", r"^platform$"),
    ("model", r"^(model|model\s*/\s*series|product\s*line)$"),
    ("upc", r"^upc$"),
    ("mpn", r"^mpn$"),
]
_SPEC_RE = [(k, re.compile(p, re.I)) for k, p in SPEC_KEYS]
_LINE_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9 /&\-\.]{1,40}?)\s*:\s*(.{1,240}?)\s*$")
_PRICE_RE = re.compile(r"\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)")


def canonical(label: str) -> str | None:
    label = re.sub(r"\s+", " ", label.strip().rstrip(":"))
    for key, rx in _SPEC_RE:
        if rx.match(label):
            return key
    return None


def _as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _num(v) -> float | None:
    try:
        return float(str(v).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None


def _jsonld_products(soup):
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or tag.get_text() or "")
        except Exception:
            continue
        stack = _as_list(data)
        while stack:
            node = stack.pop()
            if not isinstance(node, dict):
                continue
            stack.extend(_as_list(node.get("@graph")))
            types = _as_list(node.get("@type"))
            if any(str(t).lower() == "product" for t in types):
                yield node


def _meta(soup, *names):
    for n in names:
        t = soup.find("meta", attrs={"property": n}) or soup.find("meta", attrs={"name": n})
        if t and t.get("content"):
            return t["content"].strip()
    return None


def parse_product_html(html: str, base_url: str = "") -> dict:
    soup = BeautifulSoup(html, "html.parser")
    out = {"name": None, "brand": None, "sku": None, "price": None, "currency": None, "inStock": None,
           "images": [], "specs": {}, "specLines": [], "url": base_url or None}

    for p in _jsonld_products(soup):
        out["name"] = out["name"] or p.get("name")
        b = p.get("brand")
        out["brand"] = out["brand"] or (b.get("name") if isinstance(b, dict) else b)
        out["sku"] = out["sku"] or p.get("sku")
        for img in _as_list(p.get("image")):
            u = img.get("url") if isinstance(img, dict) else img
            if u:
                out["images"].append(urljoin(base_url, u))
        for offer in _as_list(p.get("offers")):
            if not isinstance(offer, dict):
                continue
            price = _num(offer.get("price") or offer.get("lowPrice"))
            if price is not None and out["price"] is None:
                out["price"] = price
                out["currency"] = offer.get("priceCurrency") or "USD"
                avail = str(offer.get("availability") or "").lower()
                if avail:
                    out["inStock"] = "instock" in avail or "in_stock" in avail
            if not out["url"] and offer.get("url"):
                out["url"] = offer["url"]

    out["name"] = out["name"] or _meta(soup, "og:title") or (soup.title.get_text(strip=True) if soup.title else None)
    if out["price"] is None:
        out["price"] = _num(_meta(soup, "product:price:amount", "og:price:amount"))
        out["currency"] = out["currency"] or _meta(soup, "product:price:currency", "og:price:currency")
    if out["price"] is None:
        # Magento: the main product's final price, not prices of related products further down
        main = soup.select_one(".product-info-main, .product-info-price, .price-box") or soup
        tag = main.select_one('[data-price-type="finalPrice"][data-price-amount]') or main.select_one("[data-price-amount]")
        if tag is not None:
            out["price"] = _num(tag.get("data-price-amount"))
            out["currency"] = out["currency"] or "USD"
    og_img = _meta(soup, "og:image")
    if og_img:
        out["images"].append(urljoin(base_url, og_img))

    specs: dict[str, str] = {}
    lines: list[tuple[str, str]] = []

    # 1) spec tables: <th>Label</th><td>Value</td>
    for tr in soup.select("table tr"):
        th, td = tr.find("th"), tr.find("td")
        if th and td:
            lines.append((th.get_text(" ", strip=True), td.get_text(" ", strip=True)))

    # 2) "Label: value" lines inside description / details blocks
    blocks = soup.find_all(attrs={"class": re.compile(r"(description|detail|overview|spec|attribute|feature)", re.I)})
    blocks += soup.find_all(attrs={"id": re.compile(r"(description|detail|overview|spec)", re.I)})
    seen_blocks = set()
    for blk in blocks:
        if id(blk) in seen_blocks:
            continue
        seen_blocks.add(id(blk))
        for br in blk.find_all("br"):
            # html.parser sometimes nests content inside <br>; keep it and just mark the line break
            br.insert_before("\n")
            br.unwrap()
        for li in [blk] + blk.find_all(["li", "p", "div", "span"]):
            text = li.get_text(" ", strip=False)
            for raw in text.split("\n"):
                m = _LINE_RE.match(raw.replace("\xa0", " "))
                if m:
                    lines.append((m.group(1), m.group(2)))

    for label, value in lines:
        value = re.sub(r"\s+", " ", value).strip(" ;,")
        if not value or len(value) > 240:
            continue
        key = canonical(label)
        if key and key not in specs:
            specs[key] = value
        pair = (re.sub(r"\s+", " ", label).strip(), value)
        if pair not in out["specLines"] and len(out["specLines"]) < 60:
            out["specLines"].append(pair)
    out["brand"] = out["brand"] or specs.pop("brand", None)
    specs.pop("brand", None)
    out["specs"] = specs

    # de-duplicate images keeping order, prefer full-size Magento files over cache copies
    seen, imgs = set(), []
    for u in out["images"]:
        key = re.sub(r"/cache/[0-9a-f]{32}/", "/", u.split("?")[0])
        if key not in seen:
            seen.add(key)
            imgs.append(u)
    out["images"] = imgs[:12]
    if out["name"]:
        out["name"] = re.sub(r"\s*\|\s*[^|]+$", "", out["name"]).strip()
    return out
