"""What a gun costs: its base price (or the lower and upper it was built from), plus the
parts bought for it, plus its attachments. Each line is either owned or planned."""

from . import builds

STATUSES = ("owned", "planned")


def _num(v):
    try:
        return round(float(v), 2) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def _status(v, default="owned"):
    return v if v in STATUSES else default


def line_price(obj: dict) -> tuple[float | None, str]:
    """An explicit price wins; otherwise the list price found by Refresh metadata."""
    p = _num(obj.get("price"))
    if p is not None:
        return p, "set"
    lp = _num(obj.get("listPrice", (obj.get("specs") or {}).get("listPrice")))
    if lp is not None:
        return lp, "list"
    return None, "none"


def breakdown(gun: dict) -> dict:
    gun_status = _status(gun.get("status"))
    lines = []
    comps = gun.get("components") or []
    if comps:
        for i, c in enumerate(comps):
            price, src = line_price(c)
            lines.append({"kind": "component", "id": str(i), "label": c.get("name") or f"Component {i + 1}",
                          "price": price, "priceSource": src, "status": _status(c.get("status"), gun_status)})
    else:
        price, src = line_price(gun)
        lines.append({"kind": "base", "id": "base", "label": "The gun", "price": price, "priceSource": src, "status": gun_status})
    for p in gun.get("parts", []):
        price, src = line_price(p)
        lines.append({"kind": "part", "id": p["id"], "label": p.get("name", p["id"]), "price": price, "priceSource": src,
                      "status": _status(p.get("status"), gun_status)})
    for r in gun.get("build") or []:
        # Factory parts are in the gun's price and bought parts are priced in parts/;
        # only upgrades picked in the Build tab add to the total.
        if r.get("source") != "upgrade" or not (r.get("name") or "").strip():
            continue
        price, src = line_price(r)
        lines.append({"kind": "upgrade", "id": r["slot"], "label": f"{r.get('label') or r['slot']}: {r['name']}",
                      "price": price, "priceSource": "catalog" if src == "list" else src,
                      "status": _status(r.get("status"), "planned")})
    for a in gun.get("attachments", []):
        price, src = line_price(a)
        # mounts, adapters and the dot on an offset mount are bought with the attachment
        extras = [builds.catalog_accessory(a[k]) for k in ("mount", "ad", "sub") if a.get(k)]
        extras = [x for x in extras if x and x.get("p")]
        label = a.get("name", a["id"])
        if extras:
            label += " + " + ", ".join(x["n"] for x in extras)
            if price is not None:  # an attachment without a price stays "no price yet"
                price = round(price + sum(float(x["p"]) for x in extras), 2)
        lines.append({"kind": "attachment", "id": a["id"], "label": label, "price": price, "priceSource": src,
                      "status": _status(a.get("status"), gun_status)})
    owned = round(sum(l["price"] or 0 for l in lines if l["status"] == "owned"), 2)
    planned = round(sum(l["price"] or 0 for l in lines if l["status"] == "planned"), 2)
    return {
        "status": gun_status,
        "lines": lines,
        "owned": owned,
        "planned": planned,
        "total": round(owned + planned, 2),
        "missing": sum(1 for l in lines if l["price"] is None),
    }
