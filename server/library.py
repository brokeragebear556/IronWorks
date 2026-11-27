"""The gun library: one folder per gun under guns/. Folders are the source of truth,
so a gun can be added by copying a folder or through the API."""
import contextlib
import json
import os
import re
import shutil
import time
import urllib.parse
from pathlib import Path

from . import builds, pricing
from .config import CATALOG, DEMO_GUNS, GUNS, IMG_EXT, REMOVED, VIEWS

SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


class LibraryError(ValueError):
    """A problem the user can fix; the message is shown in the page."""


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")
    return s[:48] or "item"


def read_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


_history_on = True
HISTORY_KEEP = 100


@contextlib.contextmanager
def no_history():
    """Writes inside this block aren't recorded for Undo (used by Undo itself and bulk reorders)."""
    global _history_on
    old, _history_on = _history_on, False
    try:
        yield
    finally:
        _history_on = old


def _snapshot(path: Path) -> None:
    """Keep the previous version of a gun or part file in guns/_history so the change can be undone."""
    if not _history_on or not path.is_file():
        return
    try:
        rel = path.resolve().relative_to(GUNS.resolve())
    except ValueError:
        return
    if rel.parts[0].startswith("_"):
        return
    hist = GUNS / "_history"
    hist.mkdir(parents=True, exist_ok=True)
    entry = {"path": rel.as_posix(), "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "content": read_json(path)}
    name = f"{time.time_ns()}.json"
    with open(hist / name, "w", encoding="utf-8") as f:
        json.dump(entry, f, ensure_ascii=False)
    old = sorted(hist.glob("*.json"))
    for p in old[:-HISTORY_KEEP]:
        p.unlink(missing_ok=True)


def write_json(path: Path, data) -> None:
    _snapshot(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def unique_path(directory: Path, base: str, ext: str = "") -> Path:
    path = directory / f"{base}{ext}"
    n = 2
    while path.exists():
        path = directory / f"{base}-{n}{ext}"
        n += 1
    return path


def catalog() -> dict:
    return read_json(CATALOG)


def _images(folder: Path, url_prefix: str) -> list[str]:
    if not folder.is_dir():
        return []
    return [url_prefix + urllib.parse.quote(f.name) for f in sorted(folder.iterdir())
            if f.is_file() and f.suffix.lower() in IMG_EXT and not f.name.startswith(".")]


def gun_folder(gun_id: str) -> Path:
    if not gun_id or not SAFE_ID.fullmatch(gun_id) or gun_id.startswith("_"):
        raise LibraryError("Unknown gun.")
    folder = GUNS / gun_id
    if not (folder / "gun.json").is_file():
        raise LibraryError("That gun folder no longer exists.")
    return folder


def part_file(gun_id: str, part_id: str) -> Path:
    folder = gun_folder(gun_id)
    if not part_id or not SAFE_ID.fullmatch(part_id):
        raise LibraryError("Unknown part.")
    path = folder / "parts" / f"{part_id}.json"
    if not path.is_file():
        raise LibraryError("That part no longer exists.")
    return path


def load_gun(folder: Path, errors: list[str] | None = None) -> dict | None:
    name = folder.name
    try:
        gun = read_json(folder / "gun.json")
    except Exception as e:  # report instead of failing the whole library
        if errors is not None:
            errors.append(f"guns/{name}/gun.json: {e}")
        return None
    gun["id"] = name
    url = f"/guns/{urllib.parse.quote(name)}/"
    gun["photos"] = {v: _images(folder / "photos" / v, f"{url}photos/{v}/") for v in VIEWS}
    gun.setdefault("attachments", [])
    gun.setdefault("specs", {})
    gun.setdefault("links", [])
    parts = []
    parts_dir = folder / "parts"
    if parts_dir.is_dir():
        for f in sorted(parts_dir.glob("*.json")):
            if f.name.startswith(("_", ".")):
                continue
            try:
                part = read_json(f)
            except Exception as e:
                if errors is not None:
                    errors.append(f"guns/{name}/parts/{f.name}: {e}")
                continue
            part["id"] = f.stem
            part["photos"] = _images(folder / "photos" / "parts" / f.stem, f"{url}photos/parts/{urllib.parse.quote(f.stem)}/")
            part.setdefault("specs", {})
            part.setdefault("links", [])
            parts.append(part)
    parts.sort(key=lambda p: (p.get("order", 99), p.get("name", "")))
    gun["parts"] = parts
    gun["pricing"] = pricing.breakdown(gun)
    return gun


def seed_demo() -> list[str]:
    """On a fresh install (no gun folders yet) copy the demo guns in, so there's something to look at.
    Never runs once you have guns of your own."""
    GUNS.mkdir(exist_ok=True)
    if any(f.is_dir() and not f.name.startswith(("_", ".")) for f in GUNS.iterdir()) or not DEMO_GUNS.is_dir():
        return []
    added = []
    for src in sorted(DEMO_GUNS.iterdir()):
        if src.is_dir() and (src / "gun.json").is_file():
            shutil.copytree(src, GUNS / src.name)
            added.append(src.name)
    return added


def list_guns() -> dict:
    GUNS.mkdir(exist_ok=True)
    guns, errors = [], []
    for folder in sorted(GUNS.iterdir()):
        if not folder.is_dir() or folder.name.startswith(("_", ".")) or not (folder / "gun.json").is_file():
            continue
        g = load_gun(folder, errors)
        if g:
            guns.append(g)
    guns.sort(key=lambda g: (g.get("order", 99), g.get("name", "")))
    return {"guns": guns, "errors": errors}


def get_gun(gun_id: str) -> dict:
    g = load_gun(gun_folder(gun_id))
    if not g:
        raise LibraryError("That gun.json could not be read.")
    return g


DERIVED = ("id", "parts", "photos", "pricing")


def _clean(data: dict) -> dict:
    return {k: v for k, v in data.items() if k not in DERIVED}


def create_gun(data: dict) -> str:
    name = str(data.get("name", "")).strip()
    if not name:
        raise LibraryError("A gun needs a name.")
    order = data.get("order") or 0
    try:
        order = int(order)
    except (TypeError, ValueError):
        order = 0
    if order <= 0:
        order = max([g.get("order", 0) for g in list_guns()["guns"]] + [0]) + 1
    data = _clean(data)
    for k in ("platform", "cfg", "build", "caliber", "twist", "fit", "rimfire", "records", "cleanEvery", "checks"):
        if k in data:
            _check_build(k, data[k])
    for k in ("price", "status"):
        if k in data:
            _check_money(k, data[k])
    data["order"] = order
    folder = unique_path(GUNS, f"{order:02d}-{slug(name)}")
    (folder / "parts").mkdir(parents=True)
    write_json(folder / "gun.json", data)
    return folder.name


EDITABLE = {"name", "short", "order", "type", "platform", "sources", "children", "model", "upgrades", "bom",
            "checks", "attachments", "specs", "links", "notes", "views", "coverPhoto", "status", "price", "components",
            "caliber", "twist", "rimfire", "fit", "cfg", "build", "records", "cleanEvery"}

RECORD_TEXT = ("mfr", "serial", "acquired", "source", "notes", "paid")
NFA_ITEMS = ("none", "sbr", "sbs", "aow", "suppressor", "mg", "dd")
NFA_STATUSES = ("", "planned", "pending", "approved", "denied", "transferred")
NFA_TEXT = ("form", "ctl", "filed", "approved")


def _check_records(k: str, v) -> None:
    """Identity, acquisition and NFA paperwork, kept in gun.json on this computer only."""
    if k == "cleanEvery" and v is not None:
        if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 100000:
            raise LibraryError("The cleaning interval must be a whole number of rounds.")
    if k == "checks":
        if not isinstance(v, list) or len(v) > 200:
            raise LibraryError("Checks must be a list.")
        for c in v:
            if not isinstance(c, dict) or c.get("level") not in ("ok", "check", "fail", "warn", "info") \
                    or not isinstance(c.get("text"), str) or not c["text"].strip() or len(c["text"]) > 1000:
                raise LibraryError("Each note needs some text and a level of ok, check or fail.")
    if k == "records":
        if not isinstance(v, dict):
            raise LibraryError("Records must be a set of named values.")
        for kk, vv in v.items():
            if kk in RECORD_TEXT:
                if vv is not None and (not isinstance(vv, str) or len(vv) > 2000):
                    raise LibraryError(f"'{kk}' must be text.")
            elif kk == "scaleWeightLb":
                if vv is not None and (isinstance(vv, bool) or not isinstance(vv, (int, float)) or not 0 < vv < 100):
                    raise LibraryError("Scale weight must be in pounds, like 6.4.")
            elif kk == "nfa":
                _check_nfa(vv, item=True)
            else:
                raise LibraryError(f"'{kk}' isn't a records field.")


def _check_nfa(v, item: bool) -> None:
    if v is None:
        return
    if not isinstance(v, dict):
        raise LibraryError("The NFA record must be a set of named values.")
    for kk, vv in v.items():
        if kk == "item" and item:
            if vv not in NFA_ITEMS:
                raise LibraryError("Unknown NFA item type.")
        elif kk == "status":
            if vv not in NFA_STATUSES:
                raise LibraryError("Unknown NFA status.")
        elif kk in NFA_TEXT:
            if vv is not None and (not isinstance(vv, str) or len(vv) > 120):
                raise LibraryError(f"'{kk}' must be short text.")
        else:
            raise LibraryError(f"'{kk}' isn't an NFA field.")


def _check_build(k: str, v) -> None:
    _check_records(k, v)
    try:
        builds.check(k, v, _check_money)
    except builds.BuildError as e:
        raise LibraryError(str(e)) from None


def _check_money(k: str, v) -> None:
    if k == "status" and v not in pricing.STATUSES:
        raise LibraryError("Status must be owned or planned.")
    if k == "price" and v is not None:
        try:
            if float(v) < 0:
                raise ValueError
        except (TypeError, ValueError):
            raise LibraryError("Price must be a number of zero or more.")
    if k == "components":
        if not isinstance(v, list):
            raise LibraryError("Components must be a list.")
        for c in v:
            if not isinstance(c, dict) or not str(c.get("name", "")).strip():
                raise LibraryError("Each component needs a name.")
            for kk in ("price", "status"):
                if kk in c:
                    _check_money(kk, c[kk])


def update_gun(gun_id: str, changes: dict) -> dict:
    folder = gun_folder(gun_id)
    path = folder / "gun.json"
    gun = read_json(path)
    for k, v in changes.items():
        if k not in EDITABLE:
            raise LibraryError(f"'{k}' can't be changed here.")
        if k == "name" and not str(v).strip():
            raise LibraryError("A gun needs a name.")
        _check_money(k, v)
        _check_build(k, v)
        gun[k] = v
    write_json(path, gun)
    return get_gun(gun_id)


def update_part(gun_id: str, part_id: str, changes: dict) -> None:
    path = part_file(gun_id, part_id)
    part = read_json(path)
    for k, v in changes.items():
        if k not in EDITABLE:
            raise LibraryError(f"'{k}' can't be changed here.")
        _check_money(k, v)
        part[k] = v
    write_json(path, part)


def _stamp() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


def remove_gun(gun_id: str) -> str:
    folder = gun_folder(gun_id)
    REMOVED.mkdir(parents=True, exist_ok=True)
    dest = unique_path(REMOVED, f"{gun_id}-{_stamp()}")
    shutil.move(str(folder), str(dest))
    return str(dest.relative_to(GUNS.parent))


def create_part(gun_id: str, data: dict) -> str:
    folder = gun_folder(gun_id)
    name = str(data.get("name", "")).strip()
    if not name:
        raise LibraryError("A part needs a name.")
    parts_dir = folder / "parts"
    parts_dir.mkdir(exist_ok=True)
    path = unique_path(parts_dir, slug(name), ".json")
    write_json(path, _clean(data))
    return path.stem


def remove_part(gun_id: str, part_id: str) -> str:
    src = part_file(gun_id, part_id)
    dest_dir = REMOVED / "parts"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = unique_path(dest_dir, f"{gun_id}--{part_id}-{_stamp()}", ".json")
    shutil.move(str(src), str(dest))
    return str(dest.relative_to(GUNS.parent))


def add_attachment(gun_id: str, data: dict) -> str:
    folder = gun_folder(gun_id)
    name = str(data.get("name", "")).strip()
    if not name:
        raise LibraryError("An attachment needs a name.")
    if data.get("type") not in catalog().get("attachments", {}):
        raise LibraryError("Unknown attachment type.")
    _check_cid(data.get("cid"))
    for k in ("price", "status"):
        if k in data:
            _check_money(k, data[k])
    path = folder / "gun.json"
    gun = read_json(path)
    atts = gun.setdefault("attachments", [])
    taken = {a.get("id") for a in atts}
    base = slug(name)
    att_id, n = base, 2
    while att_id in taken:
        att_id, n = f"{base}-{n}", n + 1
    data = dict(data, id=att_id)
    atts.append(data)
    write_json(path, gun)
    return att_id


ATT_EDITABLE = {"name", "details", "position", "side", "color", "price", "status", "cid", "pos", "clock", "h", "mount", "ad", "sub", "serial", "nfa"}
# placement numbers: inches from the chamber, clock position, optic height over the rail
_ATT_RANGES = {"pos": (-40.0, 60.0), "clock": (0, 11), "h": (0.2, 4.0)}


def _check_cid(v) -> None:
    if v is not None and (not isinstance(v, str) or builds.catalog_accessory(v) is None):
        raise LibraryError("That accessory isn't in the catalog.")


def _check_placement(k: str, v) -> None:
    if k == "serial" and v is not None and (not isinstance(v, str) or len(v) > 80):
        raise LibraryError("The serial must be short text.")
    if k == "nfa":
        _check_nfa(v, item=False)
    if k in ("cid", "mount", "ad", "sub"):
        _check_cid(v)
    if k in _ATT_RANGES and v is not None:
        lo, hi = _ATT_RANGES[k]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
            raise LibraryError(f"{k} must be a number from {lo} to {hi}.")


def update_attachment(gun_id: str, att_id: str, changes: dict) -> None:
    folder = gun_folder(gun_id)
    path = folder / "gun.json"
    gun = read_json(path)
    att = next((a for a in gun.get("attachments", []) if a.get("id") == att_id), None)
    if att is None:
        raise LibraryError("That attachment no longer exists.")
    for k, v in changes.items():
        if k not in ATT_EDITABLE:
            raise LibraryError(f"'{k}' can't be changed here.")
        _check_money(k, v)
        _check_placement(k, v)
        if k == "name" and not str(v).strip():
            raise LibraryError("An attachment needs a name.")
        if v is None and k in ("pos", "clock", "h", "mount", "ad", "sub", "cid"):
            att.pop(k, None)
        else:
            att[k] = v
    write_json(path, gun)


def remove_attachment(gun_id: str, att_id: str) -> str:
    folder = gun_folder(gun_id)
    path = folder / "gun.json"
    gun = read_json(path)
    atts = gun.get("attachments", [])
    removed = [a for a in atts if a.get("id") == att_id]
    if not removed:
        raise LibraryError("That attachment no longer exists.")
    gun["attachments"] = [a for a in atts if a.get("id") != att_id]
    write_json(path, gun)
    dest_dir = REMOVED / "attachments"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = unique_path(dest_dir, f"{gun_id}--{slug(att_id)}-{_stamp()}", ".json")
    write_json(dest, removed[0])
    return str(dest.relative_to(GUNS.parent))


def photo_dir(gun_id: str, target: str) -> Path:
    folder = gun_folder(gun_id)
    if target in VIEWS:
        return folder / "photos" / target
    if target.startswith("part:"):
        part_file(gun_id, target[5:])
        return folder / "photos" / "parts" / target[5:]
    raise LibraryError("Unknown place to put the photo.")


def save_photo(gun_id: str, target: str, filename: str, raw: bytes, ext: str) -> str:
    dest = photo_dir(gun_id, target)
    dest.mkdir(parents=True, exist_ok=True)
    path = unique_path(dest, slug(Path(filename or "photo").stem), ext)
    path.write_bytes(raw)
    return "/guns/" + urllib.parse.quote(path.relative_to(GUNS).as_posix())


def resolve_gun_url(gun_id: str, url: str, subdir: str) -> Path:
    """Turn a /guns/<id>/<subdir>/... URL back into a file path, refusing anything outside it."""
    folder = gun_folder(gun_id)
    prefix = f"/guns/{urllib.parse.quote(gun_id)}/"
    if not url.startswith(prefix + subdir + "/"):
        raise LibraryError("That file is not part of this gun.")
    path = (folder / urllib.parse.unquote(url[len(prefix):])).resolve()
    root = (folder / subdir).resolve()
    if root not in path.parents or not path.is_file():
        raise LibraryError("That file no longer exists.")
    return path


def remove_photo(gun_id: str, url: str) -> str:
    src = resolve_gun_url(gun_id, url, "photos")
    dest_dir = REMOVED / "photos"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = unique_path(dest_dir, f"{gun_id}--{src.stem}-{_stamp()}", src.suffix)
    shutil.move(str(src), str(dest))
    return str(dest.relative_to(GUNS.parent))


def save_receipt(gun_id: str, filename: str, raw: bytes, ext: str) -> str:
    folder = gun_folder(gun_id) / "receipts"
    folder.mkdir(parents=True, exist_ok=True)
    path = unique_path(folder, slug(Path(filename or "receipt").stem), ext)
    path.write_bytes(raw)
    return "/guns/" + urllib.parse.quote(path.relative_to(GUNS).as_posix())


def item_exists(key: str) -> tuple[str, str | None]:
    """An item key is a gun id or '<gun id>/<part id>'. Returns (gun_id, part_id)."""
    gun_id, _, part_id = key.partition("/")
    gun_folder(gun_id)
    if part_id:
        part_file(gun_id, part_id)
    return gun_id, (part_id or None)


def get_item(key: str) -> dict:
    gun_id, part_id = item_exists(key)
    gun = get_gun(gun_id)
    if part_id:
        return next(p for p in gun["parts"] if p["id"] == part_id)
    return gun


def update_item(key: str, changes: dict) -> None:
    gun_id, part_id = item_exists(key)
    if part_id:
        update_part(gun_id, part_id, changes)
    else:
        update_gun(gun_id, changes)
