"""Who may use Ironworks, and from where.

By default Ironworks only listens on this computer (127.0.0.1). Settings -> Network can let other
devices on your network open it (like Jellyfin); then it listens on every network address, and other
devices must sign in with the password you set. This computer never needs the password.
Requests for an unknown host name are refused, which blocks DNS-rebinding tricks from websites.
"""
import hashlib
import hmac
import html
import ipaddress
import os
import secrets
import socket
import time
from collections import defaultdict, deque

from . import db

COOKIE = "iw_session"
SESSION_DAYS = 30
ITERATIONS = 200_000
MIN_PASSWORD = 8
# the address the server was started on (set by `python -m server`); tests run as local-only
BOUND_HOST_ENV = "IW_BOUND_HOST"


# ---------- passwords and sessions ----------
def hash_password(password: str, salt: bytes | None = None) -> dict:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return {"salt": salt.hex(), "hash": digest.hex(), "iterations": ITERATIONS}


def check_password(password: str, stored: dict | None) -> bool:
    if not stored or not stored.get("hash"):
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(stored["salt"]), int(stored.get("iterations", ITERATIONS)))
    return hmac.compare_digest(digest.hex(), stored["hash"])


def _ensure_table() -> None:
    with db.tx() as c:
        c.execute("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created REAL NOT NULL, ip TEXT)")


def new_session(ip: str) -> str:
    _ensure_table()
    token = secrets.token_urlsafe(32)
    with db.tx() as c:
        c.execute("DELETE FROM sessions WHERE created < ?", (time.time() - SESSION_DAYS * 86400,))
        c.execute("INSERT INTO sessions(token, created, ip) VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), time.time(), ip))
    return token


def valid_session(token: str | None) -> bool:
    if not token:
        return False
    _ensure_table()
    row = db.one("SELECT created FROM sessions WHERE token=?", (hashlib.sha256(token.encode()).hexdigest(),))
    return bool(row) and row["created"] > time.time() - SESSION_DAYS * 86400


def end_session(token: str | None) -> None:
    if token:
        _ensure_table()
        with db.tx() as c:
            c.execute("DELETE FROM sessions WHERE token=?", (hashlib.sha256(token.encode()).hexdigest(),))


def end_all_sessions() -> None:
    _ensure_table()
    with db.tx() as c:
        c.execute("DELETE FROM sessions")


# ---------- failed sign-in limit ----------
_fails: dict[str, deque] = defaultdict(deque)


def too_many_failures(ip: str) -> bool:
    q = _fails[ip]
    while q and q[0] < time.time() - 600:
        q.popleft()
    return len(q) >= 10


def record_failure(ip: str) -> None:
    _fails[ip].append(time.time())


# ---------- network ----------
def network_settings() -> dict:
    return db.get_settings().get("network") or {}


def lan_enabled() -> bool:
    n = network_settings()
    return bool(n.get("lan")) and bool((n.get("password") or {}).get("hash"))


def bound_host() -> str:
    return os.environ.get(BOUND_HOST_ENV, "127.0.0.1")


def is_local(ip: str | None) -> bool:
    try:
        return ipaddress.ip_address(ip or "").is_loopback
    except ValueError:
        return False


def local_addresses() -> list[str]:
    """This computer's IPv4 addresses on its networks (for the address to share)."""
    found = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(info[4][0])
    except OSError:
        pass
    try:  # the address used to reach other machines (no packets are sent)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            found.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(a for a in found if not a.startswith(("127.", "169.254.")))


def allowed_hosts() -> set[str]:
    hosts = {"127.0.0.1", "localhost", "[::1]", "::1", "testserver"}
    if lan_enabled():
        name = socket.gethostname().lower()
        hosts |= {name, f"{name}.local", f"{name}.lan", f"{name}.home"} | set(local_addresses())
    return hosts


def host_ok(host_header: str | None) -> bool:
    if not host_header:
        return False
    h = host_header.lower()
    host = h[: h.rfind("]") + 1] if h.startswith("[") else h.split(":")[0]
    return host in allowed_hosts()


# ---------- sign-in page ----------
def login_page(error: str = "", next_url: str = "/") -> str:
    err = f'<p class="err" role="alert">{html.escape(error)}</p>' if error else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Ironworks</title><link rel="icon" href="/favicon.svg"><style>
:root{{color-scheme:dark}}body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#111316;color:#e6e8eb;font:15px/1.45 system-ui,sans-serif}}
form{{width:min(340px,calc(100vw - 32px));background:#171a1e;border:1px solid #2a2e35;border-radius:10px;padding:24px;display:flex;flex-direction:column;gap:12px}}
h1{{margin:0;font-size:22px}}p{{margin:0;color:#9097a1;font-size:13.5px}}label{{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#9097a1}}
input{{background:#111316;border:1px solid #2a2e35;border-radius:6px;padding:9px;color:#e6e8eb;font-size:15px}}input:focus{{outline:2px solid #d9a441}}
button{{background:#d9a441;border:0;border-radius:6px;padding:10px;font-weight:600;color:#1a1408;cursor:pointer;font-size:15px}}.err{{color:#e07a6a}}
</style></head><body><form method="post" action="/login"><h1>Ironworks</h1><p>Sign in to open the collection on this network.</p>{err}
<input type="hidden" name="next" value="{html.escape(next_url)}">
<label>Password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
<button type="submit">Sign in</button></form></body></html>"""
