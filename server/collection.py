"""Collection-wide actions: undo, duplicate, reorder, export and import."""
import csv
import io
import json
import shutil
import time
from pathlib import Path

from . import db, library
from .library import LibraryError, read_json, slug, unique_path, write_json

FORMAT = "ironworks"
OLD_FORMATS = ("collection-workbench",)  # exports made before the rename
VERSION = 1
LOG_KINDS = ("purchase", "rounds", "maintenance", "range", "nfa", "note", "malfunction", "part")
LOG_FIELDS = ("kind", "date", "title", "amount", "rounds", "category", "vendor", "notes")


# ---------- undo ----------
def _history_files() -> list[Path]:
    hist = library.GUNS / "_history"
    return sorted(hist.glob("*.json")) if hist.is_dir() else []


def _gun_id(rel: str) -> str:
    return rel.split("/")[0]


def last_change() -> dict | None:
    """What Undo would put back: the gun, which file and which fields changed."""
    for f in reversed(_history_files()):
        try:
            e = read_json(f)
        except Exception:
            f.unlink(missing_ok=True)
            continue
        target = library.GUNS / e["path"]
        if not target.is_file():
            f.unlink(missing_ok=True)  # the gun or part was removed since; nothing to restore
            continue
        cur = read_json(target)
        changed = sorted(k for k in set(cur) | set(e["content"]) if cur.get(k) != e["content"].get(k))
        gid = _gun_id(e["path"])
        name = (read_json(library.GUNS / gid / "gun.json") or {}).get("name", gid) if (library.GUNS / gid / "gun.json").is_file() else gid
        return {"gunId": gid, "gunName": name, "file": e["path"], "at": e["at"], "fields": changed, "part": "/parts/" in e["path"]}
    return None


def undo() -> dict:
    info = last_change()
    if not info:
        raise LibraryError("Nothing to undo.")
    f = _history_files()[-1]
    e = read_json(f)
    with library.no_history():
        write_json(library.GUNS / e["path"], e["content"])
    f.unlink(missing_ok=True)
    return info


# ---------- duplicate and reorder ----------
def duplicate(gun_id: str) -> str:
    """Copy a gun folder (build, parts, photos; not receipts) as a new gun, e.g. to plan an upgrade."""
    src = library.gun_folder(gun_id)
    gun = read_json(src / "gun.json")
    order = max([g.get("order", 0) for g in library.list_guns()["guns"]] + [0]) + 1
    name = f"{gun.get('name', gun_id)} (copy)"[:120]
    dest = unique_path(library.GUNS, f"{order:02d}-{slug(name)}")
    shutil.copytree(src, dest, ignore=shutil.ignore_patterns("receipts", "*.tmp"))
    gun.update(name=name, order=order)
    with library.no_history():
        write_json(dest / "gun.json", gun)
    return dest.name


def set_order(ids: list[str]) -> None:
    known = {g["id"] for g in library.list_guns()["guns"]}
    if not isinstance(ids, list) or set(ids) != known or len(ids) != len(known):
        raise LibraryError("The new order must list every gun once.")
    with library.no_history():
        for i, gid in enumerate(ids, 1):
            path = library.gun_folder(gid) / "gun.json"
            g = read_json(path)
            if g.get("order") != i:
                g["order"] = i
                write_json(path, g)


# ---------- export ----------
def export_json() -> dict:
    guns = []
    for g in library.list_guns()["guns"]:
        folder = library.gun_folder(g["id"])
        parts = {p.stem: read_json(p) for p in sorted((folder / "parts").glob("*.json")) if not p.name.startswith(("_", "."))} if (folder / "parts").is_dir() else {}
        guns.append({"folder": g["id"], "gun": read_json(folder / "gun.json"), "parts": parts})
    logs = [{k: r[k] for k in ("gun_id",) + LOG_FIELDS} for r in db.rows("SELECT * FROM logs ORDER BY date, id")]
    values = db.rows("SELECT gun_id, value FROM gun_values")
    return {"format": FORMAT, "version": VERSION, "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "note": "Guns, parts, builds, attachments, records, logs and values. Photos and receipts stay in the guns folder.",
            "guns": guns, "logs": logs, "values": values}


def _cell(v) -> str:
    s = "" if v is None else str(v)
    # stop spreadsheet apps from running a cell as a formula
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def export_csv() -> str:
    from . import analytics
    use = {u["id"]: u for u in analytics.summary()["usage"]["byGun"]}
    values = {r["gun_id"]: r["value"] for r in db.rows("SELECT gun_id, value FROM gun_values")}
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Name", "Description", "Status", "Platform", "Caliber", "Barrel (in)", "Manufacturer", "Serial", "Acquired", "From",
                "Price paid", "Current value", "Gun", "Parts and added parts", "Attachments", "Owned total", "Planned total", "Total",
                "Items without a price", "NFA item", "NFA status", "Rounds", "Since cleaning", "Attachments list"])
    for g in library.list_guns()["guns"]:
        r, p, nfa = g.get("records") or {}, g["pricing"], (g.get("records") or {}).get("nfa") or {}
        kinds = {"gun": 0.0, "part": 0.0, "attachment": 0.0}
        for l in p["lines"]:
            k = "gun" if l["kind"] in ("base", "component") else "part" if l["kind"] in ("part", "upgrade") else "attachment"
            kinds[k] += l["price"] or 0
        u = use.get(g["id"], {})
        w.writerow([_cell(x) for x in [
            g.get("name"), g.get("short"), p["status"], g.get("platform"), g.get("caliber") or (g.get("specs") or {}).get("caliber"),
            (g.get("cfg") or {}).get("barrel"), r.get("mfr") or (g.get("specs") or {}).get("brand"), r.get("serial"), r.get("acquired"), r.get("source"),
            r.get("paid"), values.get(g["id"]), round(kinds["gun"], 2), round(kinds["part"], 2), round(kinds["attachment"], 2),
            p["owned"], p["planned"], p["total"], p["missing"], nfa.get("item"), nfa.get("status"), u.get("rounds"), u.get("sinceCleaning"),
            "; ".join(a.get("name", "") + (f" #{a['serial']}" if a.get("serial") else "") for a in g.get("attachments", [])),
        ]])
    return out.getvalue()


# ---------- import ----------
def import_json(data: dict) -> dict:
    """Adds the guns in an export as new guns. Nothing already in the library is changed."""
    if not isinstance(data, dict) or data.get("format") not in (FORMAT, *OLD_FORMATS):
        raise LibraryError("That file isn't an Ironworks export.")
    guns = data.get("guns")
    if not isinstance(guns, list) or not guns or len(guns) > 200:
        raise LibraryError("The export has no guns in it.")
    # check everything first, so a bad file adds nothing
    for item in guns:
        if not isinstance(item, dict) or not isinstance(item.get("gun"), dict) or not str(item["gun"].get("name", "")).strip():
            raise LibraryError("Every gun in the file needs a name.")
        if not isinstance(item.get("parts", {}), dict):
            raise LibraryError("Parts must be listed by id.")
    created, mapping = [], {}
    for item in guns:
        g = dict(item["gun"])
        g.pop("order", None)
        new_id = library.create_gun(g)
        created.append(new_id)
        mapping[str(item.get("folder"))] = new_id
        for pid, part in (item.get("parts") or {}).items():
            if isinstance(part, dict) and str(part.get("name", "")).strip():
                library.create_part(new_id, dict(part))
    logs = [l for l in (data.get("logs") or []) if isinstance(l, dict) and l.get("gun_id") in mapping and l.get("kind") in LOG_KINDS and isinstance(l.get("date"), str)]
    with db.tx() as c:
        for l in logs:
            c.execute("INSERT INTO logs(gun_id, kind, date, title, amount, rounds, category, vendor, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                      (mapping[l["gun_id"]], l["kind"], l["date"][:10], str(l.get("title") or "")[:300], _num(l.get("amount")), _int(l.get("rounds")),
                       l.get("category"), l.get("vendor"), str(l.get("notes") or "")[:5000], db.now()))
        for v in data.get("values") or []:
            if isinstance(v, dict) and v.get("gun_id") in mapping and _num(v.get("value")) is not None:
                c.execute("INSERT INTO gun_values(gun_id, value, updated_at) VALUES(?,?,?) ON CONFLICT(gun_id) DO UPDATE SET value=excluded.value",
                          (mapping[v["gun_id"]], _num(v["value"]), db.now()))
    return {"created": created, "logs": len(logs)}


def _num(v):
    try:
        n = float(v)
        return n if n >= 0 else None
    except (TypeError, ValueError):
        return None


def _int(v):
    n = _num(v)
    return int(n) if n is not None else None


def dumps(data: dict) -> str:
    return json.dumps(data, indent=1, ensure_ascii=False)
