"""Price tracking: re-checks tracked product pages on a schedule and keeps the history."""
import logging
import threading
from datetime import datetime, timedelta, timezone

from . import db
from .providers import FetchError, fetch_page

log = logging.getLogger("workbench.prices")


def list_tracked() -> list[dict]:
    items = db.rows("SELECT * FROM tracked ORDER BY label")
    for t in items:
        last = db.one("SELECT price, currency, in_stock, checked_at FROM prices WHERE tracked_id=? AND price IS NOT NULL "
                      "ORDER BY checked_at DESC LIMIT 1", (t["id"],))
        low = db.one("SELECT MIN(price) AS p FROM prices WHERE tracked_id=? AND price IS NOT NULL", (t["id"],))
        t["latest"] = last
        t["lowest"] = low["p"] if low else None
        t["belowTarget"] = bool(last and t["target_price"] is not None and last["price"] <= t["target_price"])
    return items


def add_tracked(item_key: str, label: str, url: str, target_price: float | None) -> int:
    with db.tx() as c:
        cur = c.execute("INSERT INTO tracked(item_key, label, url, target_price, created_at) VALUES(?,?,?,?,?) "
                        "ON CONFLICT(item_key, url) DO UPDATE SET label=excluded.label, target_price=excluded.target_price",
                        (item_key, label, url, target_price, db.now()))
        row = c.execute("SELECT id FROM tracked WHERE item_key=? AND url=?", (item_key, url)).fetchone()
    return row["id"] if row else cur.lastrowid


def history(tracked_id: int) -> list[dict]:
    return db.rows("SELECT checked_at, price, currency, in_stock FROM prices WHERE tracked_id=? ORDER BY checked_at", (tracked_id,))


def record(tracked_id: int, price: float | None, currency: str | None, in_stock: bool | None, error: str | None = None):
    stamp = db.now()
    with db.tx() as c:
        if error is None:
            c.execute("INSERT INTO prices(tracked_id, checked_at, price, currency, in_stock) VALUES(?,?,?,?,?)",
                      (tracked_id, stamp, price, currency, None if in_stock is None else int(in_stock)))
        c.execute("UPDATE tracked SET last_checked=?, last_error=? WHERE id=?", (stamp, error, tracked_id))


def check(tracked_id: int) -> dict:
    t = db.one("SELECT * FROM tracked WHERE id=?", (tracked_id,))
    if not t:
        raise ValueError("That tracked item no longer exists.")
    try:
        data = fetch_page(t["url"])
    except FetchError as e:
        record(tracked_id, None, None, None, str(e))
        return {"ok": False, "error": str(e)}
    if data.get("price") is None:
        msg = "No price found on the page."
        record(tracked_id, None, None, None, msg)
        return {"ok": False, "error": msg}
    record(tracked_id, data["price"], data.get("currency") or "USD", data.get("inStock"))
    return {"ok": True, "price": data["price"], "inStock": data.get("inStock")}


class Scheduler(threading.Thread):
    """Wakes every 15 minutes and checks anything older than the configured interval."""

    def __init__(self):
        super().__init__(daemon=True, name="price-tracker")
        self.stop = threading.Event()

    def run(self):
        delay = 30  # first check shortly after start-up, then every 15 minutes
        while not self.stop.wait(delay):
            delay = 15 * 60
            try:
                self.tick()
            except Exception:  # never let the background thread die
                log.exception("price check failed")

    def tick(self):
        cfg = db.get_settings()["priceTracking"]
        if not cfg.get("enabled"):
            return
        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, int(cfg.get("intervalHours", 24))))
        for t in db.rows("SELECT id, last_checked FROM tracked WHERE enabled=1"):
            if t["last_checked"] and datetime.fromisoformat(t["last_checked"]) > cutoff:
                continue
            if self.stop.is_set():
                return
            log.info("checking price %s", t["id"])
            check(t["id"])
