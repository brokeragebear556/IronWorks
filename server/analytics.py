"""Numbers for the dashboard: money, usage, price history and collection overview."""
from collections import Counter, defaultdict

from . import db, library, prices

CATEGORY_LABELS = {"lower": "Lower", "upper": "Upper", "gun": "Complete gun", "part": "Parts",
                   "optic": "Optics", "attachment": "Attachments", "ammo": "Ammo", "accessory": "Accessories",
                   "service": "Gunsmith / service", "tax": "Tax / fees", "other": "Other"}


def summary() -> dict:
    lib = library.list_guns()["guns"]
    names = {g["id"]: g["name"] for g in lib}
    settings = db.get_settings()
    logs = db.rows("SELECT * FROM logs ORDER BY date")

    # ---- money ----
    spent_by_gun = defaultdict(float)
    spent_by_cat = defaultdict(float)
    spent_by_month = defaultdict(float)
    for l in logs:
        if l["kind"] == "purchase" and l["amount"]:
            spent_by_gun[l["gun_id"]] += l["amount"]
            spent_by_cat[l["category"] or "other"] += l["amount"]
            spent_by_month[l["date"][:7]] += l["amount"]
    values = {r["gun_id"]: r["value"] for r in db.rows("SELECT gun_id, value FROM gun_values")}
    per_gun = []
    for g in lib:
        per_gun.append({"id": g["id"], "name": g["name"], "spent": round(spent_by_gun.get(g["id"], 0), 2),
                        "value": values.get(g["id"])})
    total_spent = round(sum(spent_by_gun.values()), 2)
    valued = [p for p in per_gun if p["value"] is not None]
    money = {
        "totalSpent": total_spent,
        "totalValue": round(sum(p["value"] for p in valued), 2) if valued else None,
        "spentOnValued": round(sum(p["spent"] for p in valued), 2) if valued else None,
        "byGun": per_gun,
        "byCategory": [{"category": CATEGORY_LABELS.get(k, k), "amount": round(v, 2)} for k, v in sorted(spent_by_cat.items(), key=lambda kv: -kv[1])],
        "byMonth": [{"month": k, "amount": round(v, 2)} for k, v in sorted(spent_by_month.items())],
    }

    # ---- usage ----
    every = int(settings.get("maintenanceRounds") or 500)
    rounds_by_gun = defaultdict(int)
    last_used, last_clean = {}, {}
    rounds_since_clean = defaultdict(int)
    malfunctions = defaultdict(int)
    rounds_by_month = defaultdict(lambda: defaultdict(int))
    for l in logs:
        gid = l["gun_id"]
        if l["kind"] in ("rounds", "range") and l["rounds"]:
            rounds_by_gun[gid] += l["rounds"]
            rounds_since_clean[gid] += l["rounds"]
            rounds_by_month[l["date"][:7]][gid] += l["rounds"]
            last_used[gid] = l["date"]
        if l["kind"] == "maintenance":
            last_clean[gid] = l["date"]
            rounds_since_clean[gid] = 0
        if l["kind"] == "malfunction":
            malfunctions[gid] += 1
    # each gun can have its own cleaning interval; the setting is the default
    interval = {g["id"]: int(g.get("cleanEvery") or every) for g in lib}
    usage = {
        "maintenanceRounds": every,
        "byGun": [{"id": g["id"], "name": g["name"], "rounds": rounds_by_gun.get(g["id"], 0),
                   "sinceCleaning": rounds_since_clean.get(g["id"], 0), "cleanEvery": interval[g["id"]],
                   "cleaningDue": rounds_since_clean.get(g["id"], 0) >= interval[g["id"]],
                   "malfunctions": malfunctions.get(g["id"], 0),
                   "lastUsed": last_used.get(g["id"]), "lastCleaned": last_clean.get(g["id"])} for g in lib],
        "byMonth": [dict({"month": m}, **{names.get(k, k): v for k, v in d.items()}) for m, d in sorted(rounds_by_month.items())],
        "totalRounds": sum(rounds_by_gun.values()),
    }

    # ---- price tracking ----
    tracked = prices.list_tracked()
    price = {"tracked": tracked, "alerts": [t for t in tracked if t["belowTarget"]]}

    # ---- overview ----
    platform, caliber, maker = Counter(), Counter(), Counter()
    parts_count = attachments_count = 0
    for g in lib:
        pf = "1522" if g.get("platform") == "ar15" and g.get("rimfire") else g.get("platform")
        names = {"ar10": "AR-10", "ar15": "AR-15", "1522": "AR-style .22", "ak": "AK", "mp5": "MP5-pattern", "pistol": "Handgun", "shotgun": "Shotgun"}
        platform[names.get(pf, "Handgun" if g.get("type") == "pistol" else "Other")] += 1
        cal = (g.get("specs") or {}).get("caliber") or g.get("caliber")
        caliber[cal or "Not set"] += 1
        maker[(g.get("specs") or {}).get("brand") or g.get("maker") or "Not set"] += 1
        parts_count += len(g.get("parts", []))
        attachments_count += len(g.get("attachments", []))
    plans = db.rows("SELECT * FROM plans ORDER BY done, created_at")
    open_plans = [p for p in plans if not p["done"]]
    overview = {
        "guns": len(lib), "parts": parts_count, "attachments": attachments_count,
        "byPlatform": [{"label": k, "count": v} for k, v in platform.most_common()],
        "byCaliber": [{"label": k, "count": v} for k, v in caliber.most_common()],
        "byMaker": [{"label": k, "count": v} for k, v in maker.most_common()],
        "plans": plans,
        "plannedCost": round(sum(p["est_cost"] or 0 for p in open_plans), 2),
    }
    # ---- what the collection costs (prices on guns, parts and attachments) ----
    cost_rows, planned_items = [], []
    for g in lib:
        p = g["pricing"]
        by_kind = defaultdict(float)
        for l in p["lines"]:
            kind = l["kind"]
            by_kind["gun" if kind in ("base", "component") else "part" if kind in ("part", "upgrade") else kind] += l["price"] or 0
            if l["status"] == "planned":
                planned_items.append({"gunId": g["id"], "gun": g["name"], "label": l["label"], "kind": l["kind"], "price": l["price"]})
        cost_rows.append({"id": g["id"], "name": g["name"], "status": p["status"], "gun": round(by_kind["gun"], 2),
                          "parts": round(by_kind["part"], 2), "attachments": round(by_kind["attachment"], 2),
                          "owned": p["owned"], "planned": p["planned"], "total": p["total"], "missing": p["missing"]})
    cost = {
        "owned": round(sum(r["owned"] for r in cost_rows), 2),
        "planned": round(sum(r["planned"] for r in cost_rows), 2),
        "total": round(sum(r["total"] for r in cost_rows), 2),
        "ownedGuns": sum(1 for r in cost_rows if r["status"] == "owned"),
        "plannedGuns": sum(1 for r in cost_rows if r["status"] == "planned"),
        "missingPrices": sum(r["missing"] for r in cost_rows),
        "byGun": cost_rows,
        "plannedItems": planned_items,
    }
    return {"money": money, "usage": usage, "prices": price, "overview": overview, "cost": cost}
