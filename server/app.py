"""Ironworks API (FastAPI). Serves the built React app and the gun folders.

Run:  .venv\\Scripts\\python -m server      ->  http://127.0.0.1:8080
"""
import json
import logging
import mimetypes
import time
import urllib.parse
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import access, analytics, builds, collection, db, library, prices, providers, wikidata
from .config import CACHE, DOC_EXT, GUNS, IMG_EXT, MAX_UPLOAD, PORT, USER_AGENT, WEB_DIST
from .library import LibraryError

log = logging.getLogger("workbench")

# File types come from the operating system (the Windows registry, or /etc/mime.types on Linux),
# which can be missing or wrong. Set the ones the app serves so every system behaves the same.
for _type, _ext in (("text/javascript", ".js"), ("text/css", ".css"), ("image/svg+xml", ".svg"), ("image/webp", ".webp"),
                    ("application/json", ".json"), ("image/jpeg", ".jpg"), ("image/png", ".png"), ("application/pdf", ".pdf")):
    mimetypes.add_type(_type, _ext)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.conn()
    library.seed_demo()
    sched = prices.Scheduler()
    sched.start()
    yield
    sched.stop.set()


app = FastAPI(title="Ironworks", version="2.0", lifespan=lifespan)

ALLOWED_ORIGINS = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}", "http://127.0.0.1:5173", "http://localhost:5173"}
PUBLIC_PATHS = ("/login", "/favicon.svg")


@app.middleware("http")
async def guard(request: Request, call_next):
    """Who may use Ironworks (see access.py):
    - only known host names (blocks DNS rebinding from websites)
    - writes only from Ironworks' own pages (blocks other websites in the same browser)
    - other devices only when network access is on, and only after signing in."""
    if not access.host_ok(request.headers.get("host")):
        return JSONResponse({"error": "Unknown host name."}, status_code=400)
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        own = f"http://{request.headers.get('host', '')}"
        if origin and origin not in ALLOWED_ORIGINS and origin != own:
            return JSONResponse({"error": "Requests from other sites are refused."}, status_code=403)
    ip = request.client.host if request.client else ""
    if not access.is_local(ip) and request.url.path not in PUBLIC_PATHS:
        if not access.lan_enabled():
            return JSONResponse({"error": "Ironworks only accepts connections from this computer."}, status_code=403)
        if not access.valid_session(request.cookies.get(access.COOKIE)):
            if request.url.path.startswith(("/api/", "/guns/")):
                return JSONResponse({"error": "Sign in first."}, status_code=401)
            nxt = urllib.parse.quote(request.url.path + (f"?{request.url.query}" if request.url.query else ""), safe="/?=&")
            return RedirectResponse(f"/login?next={nxt}", status_code=303)
    return await call_next(request)


def _safe_next(n: str | None) -> str:
    return n if n and n.startswith("/") and not n.startswith("//") else "/"


@app.get("/login", include_in_schema=False)
def login_form(request: Request, next: str = "/"):
    ip = request.client.host if request.client else ""
    if access.is_local(ip) or access.valid_session(request.cookies.get(access.COOKIE)):
        return RedirectResponse(_safe_next(next), status_code=303)
    if not access.lan_enabled():
        return HTMLResponse(access.login_page("Network access is turned off on the computer running Ironworks."), status_code=403)
    return HTMLResponse(access.login_page(next_url=_safe_next(next)))


@app.post("/login", include_in_schema=False)
async def login(request: Request):
    ip = request.client.host if request.client else ""
    form = urllib.parse.parse_qs((await request.body()).decode("utf-8", "replace"))
    password, nxt = (form.get("password") or [""])[0], _safe_next((form.get("next") or ["/"])[0])
    if not access.lan_enabled():
        return HTMLResponse(access.login_page("Network access is turned off on the computer running Ironworks."), status_code=403)
    if access.too_many_failures(ip):
        return HTMLResponse(access.login_page("Too many wrong passwords. Wait 10 minutes and try again.", nxt), status_code=429)
    if not access.check_password(password, access.network_settings().get("password")):
        access.record_failure(ip)
        return HTMLResponse(access.login_page("That password isn't right.", nxt), status_code=401)
    resp = RedirectResponse(nxt, status_code=303)
    resp.set_cookie(access.COOKIE, access.new_session(ip), max_age=access.SESSION_DAYS * 86400, httponly=True, samesite="lax", path="/")
    return resp


@app.post("/logout", include_in_schema=False)
def logout(request: Request):
    access.end_session(request.cookies.get(access.COOKIE))
    resp = RedirectResponse("/login", status_code=303)
    resp.delete_cookie(access.COOKIE, path="/")
    return resp


@app.exception_handler(LibraryError)
async def library_error(_req, exc: LibraryError):
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.exception_handler(providers.FetchError)
async def fetch_error(_req, exc: providers.FetchError):
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.exception_handler(HTTPException)
async def http_error(_req, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


def bad(msg: str, code: int = 400):
    raise HTTPException(status_code=code, detail=msg)


# ---------- library ----------
@app.get("/api/library")
def get_library():
    return library.list_guns()


@app.get("/api/catalog")
def get_catalog():
    return library.catalog()


@app.get("/api/parts-catalog")
def get_parts_catalog():
    """About 600 parts and 500 accessories with prices, weights and fit data. Changes only with
    the app, so the browser may keep it for an hour."""
    return JSONResponse(builds.parts_catalog(), headers={"Cache-Control": "private, max-age=3600"})


class GunIn(BaseModel):
    model_config = {"extra": "allow"}
    name: str


@app.post("/api/guns", status_code=201)
def create_gun(body: GunIn):
    return {"id": library.create_gun(body.model_dump())}


@app.patch("/api/guns/{gun_id}")
def patch_gun(gun_id: str, changes: dict):
    return library.update_gun(gun_id, changes)


@app.post("/api/guns/{gun_id}/duplicate", status_code=201)
def duplicate_gun(gun_id: str):
    return {"id": collection.duplicate(gun_id)}


class OrderIn(BaseModel):
    ids: list[str] = Field(max_length=500)


@app.put("/api/library/order")
def put_order(body: OrderIn):
    collection.set_order(body.ids)
    return {"ok": True}


@app.get("/api/history/last")
def history_last():
    return {"change": collection.last_change()}


@app.post("/api/history/undo")
def history_undo():
    return collection.undo()


@app.get("/api/export.json")
def export_json():
    stamp = time.strftime("%Y-%m-%d")
    return Response(collection.dumps(collection.export_json()), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="ironworks-{stamp}.json"'})


@app.get("/api/export.csv")
def export_csv():
    stamp = time.strftime("%Y-%m-%d")
    return Response("﻿" + collection.export_csv(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="ironworks-inventory-{stamp}.csv"'})


@app.post("/api/import")
async def import_collection(request: Request):
    body = await request.body()
    if len(body) > MAX_UPLOAD:
        bad("That file is too large to import.")
    try:
        data = json.loads(body)
    except ValueError:
        bad("That file isn't valid JSON.")
    return collection.import_json(data)


@app.delete("/api/guns/{gun_id}")
def delete_gun(gun_id: str):
    return {"movedTo": library.remove_gun(gun_id)}


@app.post("/api/guns/{gun_id}/parts", status_code=201)
def create_part(gun_id: str, body: GunIn):
    return {"id": library.create_part(gun_id, body.model_dump())}


@app.patch("/api/guns/{gun_id}/parts/{part_id}")
def patch_part(gun_id: str, part_id: str, changes: dict):
    library.update_part(gun_id, part_id, changes)
    return {"ok": True}


@app.delete("/api/guns/{gun_id}/parts/{part_id}")
def delete_part(gun_id: str, part_id: str):
    return {"movedTo": library.remove_part(gun_id, part_id)}


class AttachmentIn(BaseModel):
    type: str
    name: str
    details: str = ""
    position: Literal["rear", "middle", "front"] | None = None
    side: Literal["right", "left", "top", "bottom"] | None = None
    color: str = "black"
    price: float | None = Field(default=None, ge=0)
    status: Literal["owned", "planned"] = "owned"
    cid: str | None = Field(default=None, max_length=80)  # accessory id in the parts catalog


@app.post("/api/guns/{gun_id}/attachments", status_code=201)
def add_attachment(gun_id: str, body: AttachmentIn):
    return {"id": library.add_attachment(gun_id, body.model_dump(exclude_none=True))}


@app.patch("/api/guns/{gun_id}/attachments/{att_id}")
def patch_attachment(gun_id: str, att_id: str, changes: dict):
    library.update_attachment(gun_id, att_id, changes)
    return {"ok": True}


@app.delete("/api/guns/{gun_id}/attachments/{att_id}")
def delete_attachment(gun_id: str, att_id: str):
    return {"movedTo": library.remove_attachment(gun_id, att_id)}


async def _read_upload(file: UploadFile, allowed: set[str]) -> tuple[bytes, str]:
    ext = Path(file.filename or "").suffix.lower()
    if ext == ".jpeg":
        ext = ".jpg"
    if ext not in allowed:
        bad("That file type isn't supported. Use " + ", ".join(sorted(allowed)) + ".")
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        bad("That file is over 15 MB.")
    if not raw:
        bad("That file is empty.")
    return raw, ext


@app.post("/api/guns/{gun_id}/photos", status_code=201)
async def upload_photo(gun_id: str, target: str = Form(...), file: UploadFile = File(...)):
    raw, ext = await _read_upload(file, IMG_EXT)
    return {"url": library.save_photo(gun_id, target, file.filename or "photo", raw, ext)}


class UrlIn(BaseModel):
    url: str


@app.post("/api/guns/{gun_id}/photos/remove")
def remove_photo(gun_id: str, body: UrlIn):
    return {"movedTo": library.remove_photo(gun_id, body.url)}


# ---------- metadata providers ----------
@app.get("/api/providers")
def get_providers():
    settings = db.get_settings()
    out = []
    for p in settings["providers"]:
        meta = providers.PROVIDERS.get(p["id"])
        if meta:
            out.append({"id": p["id"], "enabled": bool(p.get("enabled")), **meta})
    return out


@app.get("/api/library/unmatched")
def unmatched():
    return {"folder": str(providers.scan_folder()), "files": providers.unmatched_files(library.list_guns()["guns"])}


class IdentifyIn(BaseModel):
    key: str
    url: str | None = None


@app.post("/api/identify")
def identify(body: IdentifyIn):
    return providers.identify(body.key, (body.url or "").strip() or None)


@app.post("/api/identify/upload")
async def identify_upload(key: str = Form(...), file: UploadFile = File(...)):
    """A product page saved from the user's own browser (Ctrl+S), or a PDF."""
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        bad("That file is too large (15 MB at most).")
    return providers.identify_upload(key, file.filename or "page.html", data)


class RefreshIn(BaseModel):
    key: str | None = None


@app.post("/api/refresh")
def refresh(body: RefreshIn):
    """Refresh one item (key) or, with no key, every gun and part in the library."""
    if body.key:
        return [providers.refresh(body.key)]
    return providers.refresh_all()


@app.get("/api/identify/history")
def identify_history(key: str):
    library.item_exists(key)
    return providers.history(key)


class ApplyIn(BaseModel):
    key: str
    resultId: int
    fields: list[Literal["name", "brand", "sku", "price", "url", "source"]] = []
    specs: list[str] = []
    images: list[str] = []
    imageTarget: str | None = None


def _download_image(url: str) -> tuple[bytes, str]:
    if url.startswith("/api/cache/"):
        path = (CACHE / urllib.parse.unquote(url[len("/api/cache/"):])).resolve()
        if CACHE.resolve() not in path.parents or not path.is_file():
            bad("That cached image no longer exists.")
        return path.read_bytes(), path.suffix.lower()
    providers._check_url(url)
    ua = USER_AGENT
    if (urllib.parse.urlparse(url).hostname or "").endswith(".wikimedia.org"):
        # Wikimedia's servers want the same contact-bearing name as Wikidata lookups
        ua = wikidata.user_agent(db.get_settings().get("wikidataContact") or "no contact set")
    with httpx.Client(follow_redirects=True, timeout=20, headers={"User-Agent": ua}) as c:
        r = c.get(url)
    ctype = r.headers.get("content-type", "").split(";")[0].strip()
    ext = mimetypes.guess_extension(ctype) or ""
    ext = ".jpg" if ext in (".jpe", ".jpeg") else ext
    if r.status_code >= 400 or ext not in IMG_EXT:
        bad(f"Couldn't download the image ({r.status_code}).")
    if len(r.content) > MAX_UPLOAD:
        bad("That image is over 15 MB.")
    return r.content, ext


@app.post("/api/identify/apply")
def apply_metadata(body: ApplyIn):
    import json

    row = db.one("SELECT * FROM metadata WHERE id=? AND item_key=?", (body.resultId, body.key))
    if not row:
        bad("That lookup result has expired. Run the lookup again.")
    result = json.loads(row["data"])
    data = result.get("data") or {}
    item = library.get_item(body.key)
    changes: dict = {}
    specs = dict(item.get("specs") or {})
    for f in body.fields:
        if f == "name" and data.get("name"):
            changes["name"] = data["name"]
        elif f == "brand" and data.get("brand"):
            specs["brand"] = data["brand"]
        elif f == "sku" and data.get("sku"):
            specs["sku"] = str(data["sku"])
        elif f == "price" and data.get("price") is not None:
            specs["listPrice"] = data["price"]
            specs["listPriceDate"] = row["fetched_at"][:10]
        elif f == "url" and data.get("url"):
            links = list(item.get("links") or [])
            if not any(l.get("url") == data["url"] for l in links):
                links.append({"url": data["url"], "label": urllib.parse.urlparse(data["url"]).hostname or "Product page"})
            changes["links"] = links
        elif f == "source" and result.get("provider") == "local_files":
            srcs = list(item.get("sources") or [])
            if result["source"] not in srcs:
                srcs.append(result["source"])
            changes["sources"] = srcs
    for k in body.specs:
        if k in (data.get("specs") or {}):
            specs[k] = data["specs"][k]
    changes["specs"] = specs
    library.update_item(body.key, changes)
    saved = []
    if body.images:
        gun_id, part_id = library.item_exists(body.key)
        target = f"part:{part_id}" if part_id else (body.imageTarget or "full")
        allowed = set(data.get("images") or [])
        for i, url in enumerate(body.images):
            if url not in allowed:
                bad("That image is not part of the lookup result.")
            raw, ext = _download_image(url)
            name = Path(urllib.parse.urlparse(url).path).stem or f"photo-{i + 1}"
            saved.append(library.save_photo(gun_id, target, name, raw, ext))
    return {"ok": True, "photos": saved}


# ---------- logs ----------
class LogIn(BaseModel):
    gun_id: str
    kind: Literal["purchase", "rounds", "maintenance", "range", "nfa", "note", "malfunction", "part"]
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    title: str = ""
    amount: float | None = Field(default=None, ge=0)
    rounds: int | None = Field(default=None, ge=0)
    category: str | None = None
    vendor: str | None = None
    notes: str = ""


@app.get("/api/logs")
def get_logs(gun_id: str | None = None):
    if gun_id:
        return db.rows("SELECT * FROM logs WHERE gun_id=? ORDER BY date DESC, id DESC", (gun_id,))
    return db.rows("SELECT * FROM logs ORDER BY date DESC, id DESC")


@app.post("/api/logs", status_code=201)
def add_log(body: LogIn):
    library.gun_folder(body.gun_id)
    with db.tx() as c:
        cur = c.execute("INSERT INTO logs(gun_id, kind, date, title, amount, rounds, category, vendor, notes, created_at) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?)",
                        (body.gun_id, body.kind, body.date, body.title, body.amount, body.rounds, body.category,
                         body.vendor, body.notes, db.now()))
    return {"id": cur.lastrowid}


@app.put("/api/logs/{log_id}")
def edit_log(log_id: int, body: LogIn):
    with db.tx() as c:
        n = c.execute("UPDATE logs SET kind=?, date=?, title=?, amount=?, rounds=?, category=?, vendor=?, notes=? WHERE id=?",
                      (body.kind, body.date, body.title, body.amount, body.rounds, body.category, body.vendor, body.notes, log_id)).rowcount
    if not n:
        bad("That entry no longer exists.", 404)
    return {"ok": True}


@app.delete("/api/logs/{log_id}")
def delete_log(log_id: int):
    with db.tx() as c:
        c.execute("DELETE FROM logs WHERE id=?", (log_id,))
    return {"ok": True}


@app.post("/api/logs/{log_id}/receipt", status_code=201)
async def upload_receipt(log_id: int, file: UploadFile = File(...)):
    row = db.one("SELECT gun_id FROM logs WHERE id=?", (log_id,))
    if not row:
        bad("That entry no longer exists.", 404)
    raw, ext = await _read_upload(file, DOC_EXT)
    url = library.save_receipt(row["gun_id"], file.filename or "receipt", raw, ext)
    with db.tx() as c:
        c.execute("UPDATE logs SET receipt=? WHERE id=?", (url, log_id))
    return {"url": url}


# ---------- value ----------
class ValueIn(BaseModel):
    value: float | None = Field(default=None, ge=0)


@app.put("/api/guns/{gun_id}/value")
def set_value(gun_id: str, body: ValueIn):
    library.gun_folder(gun_id)
    with db.tx() as c:
        if body.value is None:
            c.execute("DELETE FROM gun_values WHERE gun_id=?", (gun_id,))
        else:
            c.execute("INSERT INTO gun_values(gun_id, value, updated_at) VALUES(?,?,?) "
                      "ON CONFLICT(gun_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                      (gun_id, body.value, db.now()))
    return {"ok": True}


@app.get("/api/values")
def get_values():
    return db.rows("SELECT * FROM gun_values")


# ---------- price tracking ----------
class TrackIn(BaseModel):
    item_key: str
    label: str
    url: str
    target_price: float | None = Field(default=None, ge=0)


@app.get("/api/tracked")
def get_tracked():
    return prices.list_tracked()


@app.post("/api/tracked", status_code=201)
def add_tracked(body: TrackIn):
    providers._check_url(body.url)
    if not body.label.strip():
        bad("Give the tracked item a name.")
    tid = prices.add_tracked(body.item_key, body.label.strip(), body.url.strip(), body.target_price)
    return {"id": tid, **prices.check(tid)}


@app.patch("/api/tracked/{tid}")
def patch_tracked(tid: int, body: dict):
    allowed = {"target_price", "enabled", "label"}
    sets = {k: v for k, v in body.items() if k in allowed}
    if not sets:
        bad("Nothing to change.")
    with db.tx() as c:
        c.execute("UPDATE tracked SET " + ", ".join(f"{k}=?" for k in sets) + " WHERE id=?", (*sets.values(), tid))
    return {"ok": True}


@app.delete("/api/tracked/{tid}")
def delete_tracked(tid: int):
    with db.tx() as c:
        c.execute("DELETE FROM tracked WHERE id=?", (tid,))
    return {"ok": True}


@app.post("/api/tracked/{tid}/check")
def check_tracked(tid: int):
    return prices.check(tid)


@app.get("/api/tracked/{tid}/history")
def tracked_history(tid: int):
    return prices.history(tid)


# ---------- plans ----------
class PlanIn(BaseModel):
    gun_id: str
    kind: str
    option_id: str | None = None
    label: str
    est_cost: float | None = Field(default=None, ge=0)


@app.get("/api/plans")
def get_plans():
    return db.rows("SELECT * FROM plans ORDER BY done, created_at")


@app.post("/api/plans", status_code=201)
def add_plan(body: PlanIn):
    library.gun_folder(body.gun_id)
    with db.tx() as c:
        cur = c.execute("INSERT INTO plans(gun_id, kind, option_id, label, est_cost, created_at) VALUES(?,?,?,?,?,?)",
                        (body.gun_id, body.kind, body.option_id, body.label, body.est_cost, db.now()))
    return {"id": cur.lastrowid}


@app.patch("/api/plans/{pid}")
def patch_plan(pid: int, body: dict):
    with db.tx() as c:
        if "done" in body:
            c.execute("UPDATE plans SET done=? WHERE id=?", (int(bool(body["done"])), pid))
    return {"ok": True}


@app.delete("/api/plans/{pid}")
def delete_plan(pid: int):
    with db.tx() as c:
        c.execute("DELETE FROM plans WHERE id=?", (pid,))
    return {"ok": True}


# ---------- settings & analytics ----------
def public_settings() -> dict:
    """Settings for the page; the password hash never leaves the server."""
    s = db.get_settings()
    n = s.get("network") or {}
    s["network"] = {"lan": bool(n.get("lan")), "hasPassword": bool((n.get("password") or {}).get("hash"))}
    return s


@app.get("/api/settings")
def get_settings():
    return public_settings()


@app.get("/api/network")
def get_network(request: Request):
    """Network access status, and the address other devices use."""
    on, bound = access.lan_enabled(), access.bound_host()
    listening_lan = bound not in ("127.0.0.1", "localhost", "::1")
    return {
        "lan": on, "hasPassword": public_settings()["network"]["hasPassword"], "listening": bound,
        "restartNeeded": on != listening_lan, "port": PORT,
        "addresses": [f"http://{a}:{PORT}" for a in access.local_addresses()],
        "thisComputer": access.is_local(request.client.host if request.client else ""),
    }


@app.put("/api/settings")
def put_settings(values: dict, request: Request):
    if "network" in values:
        # only someone at this computer can open it up to the network or change the password
        if not access.is_local(request.client.host if request.client else ""):
            bad("Network access can only be changed on the computer running Ironworks.", 403)
        n = values.pop("network") or {}
        cur = (db.get_settings().get("network") or {})
        new = {"lan": bool(cur.get("lan")), "password": cur.get("password")}
        if "password" in n:
            pw = str(n["password"] or "")
            if pw and len(pw) < access.MIN_PASSWORD:
                bad(f"Use a password of at least {access.MIN_PASSWORD} characters.")
            new["password"] = access.hash_password(pw) if pw else None
            access.end_all_sessions()  # a new password signs everyone out
        if "lan" in n:
            if n["lan"] and not (new["password"] or {}).get("hash"):
                bad("Set a password before turning on network access.")
            new["lan"] = bool(n["lan"])
        if not new["lan"]:
            access.end_all_sessions()
        db.save_settings({"network": new})
    if "scanFolder" in values and not Path(str(values["scanFolder"])).is_dir():
        bad("That scan folder doesn't exist.")
    if "units" in values and values["units"] not in ("in", "mm"):
        bad("Units must be in or mm.")
    if "wikidataContact" in values:
        contact = str(values["wikidataContact"] or "").strip()
        if len(contact) > 200 or any(ord(ch) < 32 or ch in "()" for ch in contact):
            bad("Enter one email or web address for Wikidata.")
        if contact and not ("@" in contact or contact.startswith(("http://", "https://"))):
            bad("Enter an email address or a web address starting with https://")
        values["wikidataContact"] = contact
    if "providers" in values:
        ids = [p.get("id") for p in values["providers"]]
        if any(i not in providers.PROVIDERS for i in ids):
            bad("Unknown metadata provider.")
    if values:
        db.save_settings(values)
    return public_settings()


@app.get("/api/analytics")
def get_analytics():
    return analytics.summary()


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------- static files ----------
app.mount("/guns", StaticFiles(directory=GUNS), name="guns")
CACHE.mkdir(parents=True, exist_ok=True)
app.mount("/api/cache", StaticFiles(directory=CACHE), name="cache")

if WEB_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    """Serve the React app; unknown paths fall back to index.html for client-side routing."""
    if path.startswith("api/"):
        bad("Not found", 404)
    if not WEB_DIST.is_dir():
        return JSONResponse({"error": "The web app isn't built yet. Run: npm run build (in the web folder)."}, status_code=503)
    target = (WEB_DIST / path).resolve()
    if path and WEB_DIST.resolve() in target.parents and target.is_file():
        return FileResponse(target)
    return FileResponse(WEB_DIST / "index.html")
