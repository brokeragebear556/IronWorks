"""Paths and constants. Everything lives inside the app folder."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUNS = ROOT / "guns"          # your guns; never uploaded (see .gitignore)
DEMO_GUNS = ROOT / "demo" / "guns"  # the two demo guns that ship with the app
REMOVED = GUNS / "_removed"
DATA = ROOT / "data"
CATALOG = DATA / "catalog.json"
PARTS_CATALOG = DATA / "parts_catalog.json"  # ~600 parts and ~500 accessories with prices and weights
DB_PATH = Path(os.environ.get("WB_DB", DATA / "ironworks.db"))
OLD_DB = DATA / "workbench.db"  # the name before the app was called Ironworks
CACHE = DATA / "cache"
WEB_DIST = ROOT / "web" / "dist"
DEFAULT_SCAN_FOLDER = ROOT.parent  # the Collection folder with the saved product pages

HOST = "127.0.0.1"
PORT = int(os.environ.get("WB_PORT", "8080"))

MAX_UPLOAD = 15_000_000
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
DOC_EXT = IMG_EXT | {".pdf"}
VIEWS = ("full", "lower", "upper")

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Ironworks/2.0 (personal collection tracker)"
