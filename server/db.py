"""SQLite storage for things that are not part of a gun folder: logs, price history,
metadata lookups, planned upgrades and settings."""
import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import DATA, DB_PATH, DEFAULT_SCAN_FOLDER, OLD_DB

DATA_DB = DATA / "ironworks.db"

_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gun_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('purchase','rounds','maintenance','range','nfa','note','malfunction','part')),
  date TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  amount REAL,
  rounds INTEGER,
  category TEXT,
  vendor TEXT,
  notes TEXT NOT NULL DEFAULT '',
  receipt TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_gun ON logs(gun_id, date);
CREATE TABLE IF NOT EXISTS tracked (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  target_price REAL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_checked TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(item_key, url)
);
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracked_id INTEGER NOT NULL REFERENCES tracked(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  price REAL,
  currency TEXT,
  in_stock INTEGER
);
CREATE INDEX IF NOT EXISTS prices_tracked ON prices(tracked_id, checked_at);
CREATE TABLE IF NOT EXISTS metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS metadata_item ON metadata(item_key, fetched_at);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gun_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  option_id TEXT,
  label TEXT NOT NULL,
  est_cost REAL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gun_values (
  gun_id TEXT PRIMARY KEY,
  value REAL NOT NULL,
  updated_at TEXT NOT NULL
);
"""

DEFAULT_SETTINGS = {
    "scanFolder": str(DEFAULT_SCAN_FOLDER),
    "providers": [
        {"id": "local_files", "enabled": True},
        {"id": "product_page", "enabled": True},
        {"id": "wikidata", "enabled": True},
    ],
    # Wikimedia's robot policy wants a way to reach whoever runs the client: an email or web address.
    # It's the user's own, kept in their local database, and sent only to Wikidata.
    "wikidataContact": "",
    "priceTracking": {"enabled": True, "intervalHours": 24},
    "maintenanceRounds": 500,
    "units": "in",
    # other devices on your network: off unless turned on (with a password) in Settings -> Network
    "network": {"lan": False, "password": None},
    "experimental": {"photoProjection": False},
}


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _adopt_old_db() -> None:
    """Before the app was called Ironworks the database was data/workbench.db. Move it (and its
    write-ahead log) to the new name the first time, so nothing is lost."""
    if DB_PATH.exists() or DB_PATH != DATA_DB or not OLD_DB.exists():
        return
    for suffix in ("", "-wal", "-shm"):
        old = OLD_DB.with_name(OLD_DB.name + suffix)
        if old.exists():
            old.replace(DB_PATH.with_name(DB_PATH.name + suffix))


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    _adopt_old_db()
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


_conn: sqlite3.Connection | None = None


def conn() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            _conn = _connect()
            _migrate(_conn)
            _conn.executescript(SCHEMA)
        return _conn


def _migrate(c: sqlite3.Connection) -> None:
    """Older databases only allowed six log kinds. Rebuild the logs table to allow malfunctions
    and part changes, keeping every row."""
    row = c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='logs'").fetchone()
    if not row or "malfunction" in row[0]:
        return
    with c:
        c.execute("ALTER TABLE logs RENAME TO logs_old")
        c.execute("DROP INDEX IF EXISTS logs_gun")
        c.executescript(SCHEMA)
        c.execute("INSERT INTO logs(id, gun_id, kind, date, title, amount, rounds, category, vendor, notes, receipt, created_at) "
                  "SELECT id, gun_id, kind, date, title, amount, rounds, category, vendor, notes, receipt, created_at FROM logs_old")
        c.execute("DROP TABLE logs_old")


@contextmanager
def tx():
    c = conn()
    with _lock:
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise


def rows(sql: str, params=()) -> list[dict]:
    with _lock:
        return [dict(r) for r in conn().execute(sql, params).fetchall()]


def one(sql: str, params=()) -> dict | None:
    with _lock:
        r = conn().execute(sql, params).fetchone()
        return dict(r) if r else None


def reset_for_tests():
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn = None


# ---------- settings ----------
def _merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def get_settings() -> dict:
    stored = {r["key"]: json.loads(r["value"]) for r in rows("SELECT key, value FROM settings")}
    merged = _merge(DEFAULT_SETTINGS, stored)
    # keep every known provider in the list, even ones added after the settings were saved
    known = {p["id"] for p in merged["providers"]}
    for p in DEFAULT_SETTINGS["providers"]:
        if p["id"] not in known:
            merged["providers"].append(dict(p))
    return merged


def save_settings(values: dict) -> dict:
    current = get_settings()
    merged = _merge(current, values)
    with tx() as c:
        for k, v in merged.items():
            c.execute("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      (k, json.dumps(v)))
    return get_settings()
