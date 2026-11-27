"""Builds: what's on each gun, slot by slot, and the parts catalog the slots are filled from.

A gun's `cfg` holds the settings the 3D model is drawn from (barrel length, gas system, stock...),
and `build` lists one row per slot (trigger, BCG, grip...). A row says where the part came from:
  factory  came with the gun or the lower/upper it was built from (already in the gun's price)
  part     bought separately and kept in the gun's parts/ folder (priced there)
  upgrade  picked from the catalog or typed in; counted in the gun's price as owned or planned
"""
import functools
import re

from .config import PARTS_CATALOG

PLATFORMS = ("ar15", "ar10", "ak", "mp5", "pistol", "shotgun", "1522")  # 1522: S&W M&P15-22 (rimfire AR)
SOURCES = ("factory", "part", "upgrade")
SLOT_ID = re.compile(r"[a-z][a-z0-9_-]{0,31}")
CFG_KEY = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,31}")


class BuildError(ValueError):
    pass


@functools.lru_cache(maxsize=1)
def _load():
    import json
    with open(PARTS_CATALOG, encoding="utf-8") as f:
        data = json.load(f)
    return data, {p["id"]: p for p in data["parts"]}, {a["id"]: a for a in data["acc"]}


def parts_catalog() -> dict:
    return _load()[0]


def catalog_part(pid: str) -> dict | None:
    return _load()[1].get(pid)


def catalog_accessory(cid: str) -> dict | None:
    return _load()[2].get(cid)


def _text(v, what: str, limit: int = 200) -> str:
    if v is None:
        return ""
    if not isinstance(v, str):
        raise BuildError(f"{what} must be text.")
    if len(v) > limit:
        raise BuildError(f"{what} is too long (over {limit} characters).")
    return v


def check_cfg(cfg) -> None:
    if not isinstance(cfg, dict) or len(cfg) > 60:
        raise BuildError("The build settings must be a small set of named values.")
    for k, v in cfg.items():
        if not CFG_KEY.fullmatch(k):
            raise BuildError(f"'{k}' isn't a valid build setting name.")
        if v is not None and not isinstance(v, (str, int, float, bool)):
            raise BuildError(f"The build setting '{k}' must be a single value.")
        if isinstance(v, str) and len(v) > 120:
            raise BuildError(f"The build setting '{k}' is too long.")


def check_build(rows, check_money) -> None:
    if not isinstance(rows, list) or len(rows) > 80:
        raise BuildError("The build must be a list of slots.")
    seen = set()
    for r in rows:
        if not isinstance(r, dict):
            raise BuildError("Each build slot must be an object.")
        slot = r.get("slot")
        if not isinstance(slot, str) or not SLOT_ID.fullmatch(slot):
            raise BuildError("Each build slot needs a short id like 'trigger'.")
        if slot in seen:
            raise BuildError(f"The slot '{slot}' is listed twice.")
        seen.add(slot)
        for k in ("name", "note", "label"):
            _text(r.get(k), f"The {k} for {slot}")
        pid = r.get("pid")
        if pid is not None and (not isinstance(pid, str) or catalog_part(pid) is None):
            raise BuildError(f"'{pid}' isn't in the parts catalog.")
        if r.get("source", "factory") not in SOURCES:
            raise BuildError("A slot's source must be factory, part or upgrade.")
        if r.get("partId") is not None and not isinstance(r.get("partId"), str):
            raise BuildError("partId must be text.")
        fac = r.get("factory")
        if fac is not None:
            if not isinstance(fac, dict):
                raise BuildError("The factory part must be an object.")
            _text(fac.get("name"), f"The factory part for {slot}")
            if fac.get("pid") is not None and catalog_part(fac["pid"]) is None:
                raise BuildError(f"'{fac['pid']}' isn't in the parts catalog.")
        for k in ("price", "status"):
            if k in r:
                check_money(k, r[k])
        if "listPrice" in r and r["listPrice"] is not None:
            check_money("price", r["listPrice"])


def check(k: str, v, check_money) -> None:
    if k == "platform" and v is not None and v not in PLATFORMS:
        raise BuildError("Platform must be one of: " + ", ".join(PLATFORMS))
    if k == "cfg":
        check_cfg(v)
    if k == "build":
        check_build(v, check_money)
    if k in ("caliber", "twist", "fit"):
        _text(v, k.capitalize(), 40)
    if k == "rimfire" and not isinstance(v, bool):
        raise BuildError("rimfire must be true or false.")
