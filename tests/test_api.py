"""API tests. Each test runs against a temporary copy of the gun folders and a fresh database."""
import os
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

SAMPLE_PAGE = """<html><head><title>Test Upper | Shop</title>
<meta property="og:image" content="https://example.com/img/upper.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Test 16in Upper",
 "sku":"ABC123","brand":{"@type":"Brand","name":"TestCo"},"image":["https://example.com/img/upper.jpg"],
 "offers":{"@type":"Offer","price":"499.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>
</head><body><div class="product-description"><strong>Barrel Length</strong>: 16"<br><strong>Twist Rate</strong>: 1:7<br>
<strong>Gas System</strong>: Mid-length</div>
<table class="data table additional-attributes"><tr><th>Caliber</th><td>5.56 NATO</td></tr></table></body></html>"""


DD = "01-daniel-defense-ddm4-v7"   # demo guns from demo/guns
G17 = "02-glock-17"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """A fresh install: an empty guns folder (the demo guns are copied in at startup) and a new database."""
    guns = tmp_path / "guns"
    guns.mkdir()
    scan = tmp_path / "scan"
    scan.mkdir()
    (scan / "Test 16in Upper TestCo.html").write_text(SAMPLE_PAGE, encoding="utf-8")
    monkeypatch.setenv("WB_DB", str(tmp_path / "test.db"))

    from server import access, config, db, library
    monkeypatch.setattr(access, "is_local", lambda ip: True)  # the test client counts as this computer
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(library, "GUNS", guns)
    monkeypatch.setattr(library, "REMOVED", guns / "_removed")
    db.reset_for_tests()
    from fastapi.testclient import TestClient
    from server.app import app
    with TestClient(app) as c:
        c.put("/api/settings", json={"scanFolder": str(scan), "priceTracking": {"enabled": False}})
        yield c
    db.reset_for_tests()


def gun(client, gid):
    return next(g for g in client.get("/api/library").json()["guns"] if g["id"] == gid)


def test_fresh_install_gets_the_two_demo_guns(client):
    r = client.get("/api/library")
    assert r.status_code == 200
    guns = r.json()["guns"]
    assert [g["id"] for g in guns] == [DD, G17]
    assert guns[0]["name"] == "Daniel Defense DDM4 V7" and guns[1]["name"] == "Glock 17 Gen5"
    assert set(guns[0]["photos"]) == {"full", "lower", "upper"}


def test_demo_guns_are_not_added_when_you_have_guns(tmp_path, monkeypatch):
    from server import library
    guns = tmp_path / "guns"
    (guns / "01-my-gun").mkdir(parents=True)
    (guns / "01-my-gun" / "gun.json").write_text('{"name": "Mine"}', encoding="utf-8")
    monkeypatch.setattr(library, "GUNS", guns)
    assert library.seed_demo() == []
    assert sorted(p.name for p in guns.iterdir()) == ["01-my-gun"]


def test_create_update_and_remove_gun(client):
    r = client.post("/api/guns", json={"name": "Test Rifle", "type": "rifle"})
    assert r.status_code == 201
    gid = r.json()["id"]
    r = client.patch(f"/api/guns/{gid}", json={"short": "Updated", "specs": {"caliber": "5.56"}})
    assert r.json()["short"] == "Updated"
    assert client.patch(f"/api/guns/{gid}", json={"id": "x"}).status_code == 400
    assert client.delete(f"/api/guns/{gid}").status_code == 200
    assert all(g["id"] != gid for g in client.get("/api/library").json()["guns"])

def test_rejects_bad_ids_and_other_origins(client):
    assert client.patch("/api/guns/..data", json={"name": "x"}).status_code == 400
    assert client.patch("/api/guns/_removed", json={"name": "x"}).status_code == 400
    # an encoded slash never reaches a gun route
    assert client.patch("/api/guns/..%2F..%2Fdata", json={"name": "x"}).status_code in (400, 404, 405)
    r = client.post("/api/guns", json={"name": "x"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_attachments_round_trip(client):
    gid = DD
    r = client.post(f"/api/guns/{gid}/attachments", json={"type": "reddot", "name": "Aimpoint T-2", "position": "rear"})
    assert r.status_code == 201
    aid = r.json()["id"]
    assert client.post(f"/api/guns/{gid}/attachments", json={"type": "nope", "name": "x"}).status_code == 400
    assert client.delete(f"/api/guns/{gid}/attachments/{aid}").status_code == 200


def test_photo_upload_and_remove(client):
    gid = G17
    png = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                        "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")
    r = client.post(f"/api/guns/{gid}/photos", data={"target": "lower"}, files={"file": ("shot.png", png, "image/png")})
    assert r.status_code == 201, r.text
    url = r.json()["url"]
    assert client.post(f"/api/guns/{gid}/photos", data={"target": "../x"}, files={"file": ("a.png", png)}).status_code == 400
    assert client.post(f"/api/guns/{gid}/photos", data={"target": "lower"}, files={"file": ("a.exe", b"MZ")}).status_code == 400
    assert client.post(f"/api/guns/{gid}/photos/remove", json={"url": f"/guns/{gid}/gun.json"}).status_code == 400
    assert client.post(f"/api/guns/{gid}/photos/remove", json={"url": url}).status_code == 200


def test_logs_and_analytics(client):
    gid = DD
    assert client.post("/api/logs", json={"gun_id": gid, "kind": "purchase", "date": "2026-01-10", "title": "Lower",
                                          "amount": 309.99, "category": "lower"}).status_code == 201
    client.post("/api/logs", json={"gun_id": gid, "kind": "range", "date": "2026-02-01", "rounds": 600})
    assert client.post("/api/logs", json={"gun_id": gid, "kind": "bogus", "date": "2026-01-01"}).status_code == 422
    a = client.get("/api/analytics").json()
    assert a["money"]["totalSpent"] == 309.99
    row = next(u for u in a["usage"]["byGun"] if u["id"] == gid)
    assert row["rounds"] == 600 and row["cleaningDue"] is True
    assert a["overview"]["guns"] == 2


def test_local_files_provider_and_apply(client):
    client.post("/api/guns", json={"name": "Test 16in Upper", "type": "rifle"})
    gid = next(g["id"] for g in client.get("/api/library").json()["guns"] if g["name"] == "Test 16in Upper")
    results = client.post("/api/identify", json={"key": gid}).json()
    local = [r for r in results if r["provider"] == "local_files" and "data" in r]
    assert local, results
    data = local[0]["data"]
    assert data["price"] == 499.99 and data["brand"] == "TestCo" and data["inStock"] is True
    assert data["specs"]["barrelLength"] == '16"' and data["specs"]["twist"] == "1:7"
    assert data["specs"]["caliber"] == "5.56 NATO"
    r = client.post("/api/identify/apply", json={"key": gid, "resultId": local[0]["id"],
                                                  "fields": ["brand", "price", "source"], "specs": ["twist", "caliber"]})
    assert r.status_code == 200, r.text
    g = next(g for g in client.get("/api/library").json()["guns"] if g["id"] == gid)
    assert g["specs"]["brand"] == "TestCo" and g["specs"]["twist"] == "1:7" and g["specs"]["listPrice"] == 499.99
    assert "Test 16in Upper TestCo.html" in g["sources"]


def _fake_wikidata(calls):
    """Stands in for Wikidata: a search hit for the Glock 17 and its facts (in SI units, as the query returns them)."""
    def get(url, params, contact):
        calls.append((url, contact))
        if "query" not in params:
            return {"search": [{"id": "Q172172", "label": "Glock 17", "description": "semi-automatic pistol"},
                               {"id": "Q1", "label": "Glock Ges.m.b.H.", "description": "Austrian company"}]}
        v = lambda x: {"value": x}  # noqa: E731
        row = {"item": v("http://www.wikidata.org/entity/Q172172"), "itemLabel": v("Glock 17"), "itemDescription": v("semi-automatic pistol"),
               "mfrLabel": v("Glock Ges.m.b.H."), "ammoLabel": v("9×19 mm Parabellum"), "len": v("0.204"), "hgt": v("0.138"),
               "mass": v("0.71"), "mv": v("375"), "countryLabel": v("Austria"), "inception": v("1980-01-01T00:00:00Z"),
               "img": v("http://commons.wikimedia.org/wiki/Special:FilePath/Glock%2017.jpg")}
        return {"results": {"bindings": [dict(row, brandLabel=v("Glock")), dict(row, brandLabel=v("G17"))]}}
    return get


def test_wikidata_provider(client, monkeypatch):
    from server import wikidata
    calls: list = []
    monkeypatch.setattr(wikidata, "_get", _fake_wikidata(calls))
    # needs a contact first (Wikimedia's robot policy); refresh stays quiet about it
    res = client.post("/api/identify", json={"key": G17}).json()
    wd = [r for r in res if r["provider"] == "wikidata"]
    assert wd and "Settings" in wd[0]["error"] and not calls
    assert not client.post("/api/refresh", json={"key": G17}).json()[0]["errors"]
    assert client.put("/api/settings", json={"wikidataContact": "not a contact"}).status_code == 400
    assert client.put("/api/settings", json={"wikidataContact": "me@example.com (x)"}).status_code == 400
    assert client.put("/api/settings", json={"wikidataContact": "me@example.com"}).json()["wikidataContact"] == "me@example.com"

    res = client.post("/api/identify", json={"key": G17}).json()
    wd = [r for r in res if r["provider"] == "wikidata"]
    assert len(wd) == 1 and calls and all(c == "me@example.com" for _, c in calls)
    d = wd[0]["data"]
    assert wd[0]["confidence"] == 1.0 and d["brand"] == "Glock" and d["price"] is None
    s = d["specs"]
    assert s["caliber"] == "9×19 mm Parabellum" and s["overallLength"] == '8.03"' and s["weight"] == "25 oz"
    assert s["muzzleVelocity"] == "1230 fps" and s["countryOfOrigin"] == "Austria" and s["introduced"] == "1980"
    assert d["images"] == ["https://commons.wikimedia.org/wiki/Special:FilePath/Glock%2017.jpg?width=1200"]
    assert d["url"] == "https://www.wikidata.org/wiki/Q172172"
    # parts and attachments aren't looked up there
    part = client.get("/api/library").json()["guns"]
    pkeys = [f"{g['id']}/{p['id']}" for g in part for p in g["parts"]]
    if pkeys:
        assert not [r for r in client.post("/api/identify", json={"key": pkeys[0]}).json() if r["provider"] == "wikidata"]
    # refresh fills in only what's missing; the user's own values stay
    before = gun(client, G17)["specs"]
    client.post("/api/refresh", json={"key": G17})
    after = gun(client, G17)["specs"]
    for k, val in before.items():
        assert after[k] == val
    assert after.get("muzzleVelocity") == "1230 fps"


def test_wikidata_unit_conversion():
    from server import wikidata
    f = {"itemLabel": {"Rifle X"}, "mfrLabel": {"A", "B"}, "len": {"0.87"}, "mass": {"4.3"}, "cap": {"30", "20"}, "rof": {"600"}}
    r = wikidata._to_result("Q9", f)
    assert r["brand"] is None and "manufacturer" not in r["specs"]  # several makers: not one brand
    assert r["specs"]["overallLength"] == '34.25"' and r["specs"]["weight"] == "9.48 lb"
    assert r["specs"]["capacity"] == "20, 30" and r["specs"]["rateOfFire"] == "600 rpm"
    assert wikidata._queries("Glock 17 Gen5 MOS") == ["Glock 17 Gen5 MOS", "Glock 17 Gen5", "Glock 17"]
    assert wikidata._queries("AK-47") == ["AK-47"]


def test_upload_a_saved_page(client):
    page = SAMPLE_PAGE.replace("499.99", "1299.00")
    r = client.post("/api/identify/upload", data={"key": DD}, files={"file": ("DD page.html", page.encode(), "text/html")})
    assert r.status_code == 200, r.text
    res = r.json()[0]
    assert res["provider"] == "local_files" and res["source"] == "DD page.html" and res["data"]["price"] == 1299.0
    folder = Path(client.get("/api/settings").json()["scanFolder"])
    assert (folder / "DD page.html").read_text(encoding="utf-8") == page
    # same name, different file: kept alongside, not overwritten
    r2 = client.post("/api/identify/upload", data={"key": DD}, files={"file": ("DD page.html", b"<html>other</html>", "text/html")})
    assert r2.json()[0]["source"] == "DD page (2).html" and (folder / "DD page.html").read_text(encoding="utf-8") == page
    # a result from an upload can be applied like any lookup
    a = client.post("/api/identify/apply", json={"key": DD, "resultId": res["id"], "fields": ["price"], "specs": []})
    assert a.status_code == 200 and gun(client, DD)["specs"]["listPrice"] == 1299.0
    for name in ("../../evil.html", "x.exe"):
        bad = client.post("/api/identify/upload", data={"key": DD}, files={"file": (name, b"<html></html>", "text/html")})
        assert bad.status_code == 400 or not (folder.parent / "evil.html").exists()
    assert client.post("/api/identify/upload", data={"key": DD}, files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400


def test_refresh_saves_price_and_only_missing_specs(client):
    client.post("/api/guns", json={"name": "Test 16in Upper", "type": "rifle", "specs": {"twist": "1:8 (mine)"}})
    gid = next(g["id"] for g in client.get("/api/library").json()["guns"] if g["name"] == "Test 16in Upper")
    r = client.post("/api/refresh", json={"key": gid})
    assert r.status_code == 200, r.text
    res = r.json()[0]
    assert res["price"] == 499.99 and "barrelLength" in res["specsAdded"] and "twist" not in res["specsAdded"]
    g = next(g for g in client.get("/api/library").json()["guns"] if g["id"] == gid)
    assert g["specs"]["twist"] == "1:8 (mine)"          # user's value kept
    assert g["specs"]["listPrice"] == 499.99 and g["specs"]["brand"] == "TestCo"
    every = client.post("/api/refresh", json={}).json()
    assert len(every) >= 3 and all("key" in x for x in every)


def test_pricing_adds_components_parts_and_attachments(client):
    gid = DD
    p = gun(client, gid)["pricing"]
    assert p["status"] == "owned" and p["owned"] == 1899
    # a part bought for the gun adds to its price
    assert client.post(f"/api/guns/{gid}/parts", json={"name": "Spare BCG", "price": 67.96}).status_code == 201
    # an attachment priced as planned moves to the planned total, not the owned one
    att = client.post(f"/api/guns/{gid}/attachments", json={"type": "reddot", "name": "T-2"}).json()["id"]
    assert client.patch(f"/api/guns/{gid}/attachments/{att}", json={"price": 99.5, "status": "planned"}).status_code == 200
    p = gun(client, gid)["pricing"]
    assert p["owned"] == round(1899 + 67.96, 2) and p["planned"] == 99.5 and p["total"] == round(1899 + 67.96 + 99.5, 2)
    assert client.patch(f"/api/guns/{gid}/attachments/{att}", json={"status": "maybe"}).status_code == 400
    assert client.patch(f"/api/guns/{gid}", json={"price": -5}).status_code == 400
    # a gun built from a lower and an upper is priced from those instead of one gun price
    client.patch(f"/api/guns/{G17}", json={"components": [{"name": "Frame", "listPrice": 250}, {"name": "Slide", "price": 300, "status": "planned"}]})
    p = gun(client, G17)["pricing"]
    assert p["owned"] == 250 and p["planned"] == 300
    # a planned gun counts everything as planned unless a line says otherwise
    client.patch(f"/api/guns/{G17}", json={"status": "planned", "components": []})
    cost = client.get("/api/analytics").json()["cost"]
    row = next(r for r in cost["byGun"] if r["id"] == G17)
    assert row["planned"] == 599 and row["owned"] == 0
    assert cost["total"] == round(cost["owned"] + cost["planned"], 2)


def test_refresh_updates_components_not_gun_price(client):
    page = "Test 16in Upper TestCo.html"
    gid = client.post("/api/guns", json={"name": "Test 16in Upper", "type": "rifle", "sources": [page],
                                         "components": [{"name": "Lower", "listPrice": 200}, {"name": "Upper", "source": page}]}).json()["id"]
    r = client.post("/api/refresh", json={"key": gid}).json()[0]
    assert r["price"] is None and r["componentsUpdated"]
    g = gun(client, gid)
    assert "listPrice" not in g["specs"]
    assert g["pricing"]["owned"] == round(200 + 499.99, 2)


def test_cover_photo_is_editable(client):
    png = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                        "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")
    url = client.post(f"/api/guns/{G17}/photos", data={"target": "full"}, files={"file": ("g17.png", png, "image/png")}).json()["url"]
    assert client.patch(f"/api/guns/{G17}", json={"coverPhoto": url}).json()["coverPhoto"] == url

def test_product_page_refuses_local_addresses(client):
    r = client.post("/api/identify", json={"key": DD, "url": "http://127.0.0.1:8080/"})
    assert r.status_code == 200
    errs = [x for x in r.json() if x["provider"] == "product_page"]
    assert errs and "error" in errs[0]


def test_settings_validation(client):
    assert client.put("/api/settings", json={"scanFolder": "Z:/does/not/exist"}).status_code == 400
    s = client.put("/api/settings", json={"experimental": {"photoProjection": True}}).json()
    assert s["experimental"]["photoProjection"] is True and s["maintenanceRounds"] == 500


def test_brand_from_spec_table():
    from server.parsing import parse_product_html
    d = parse_product_html("<table><tr><th>Brand</th><td>TestCo Arms</td></tr><tr><th>Caliber</th><td>.308</td></tr></table>")
    assert d["brand"] == "TestCo Arms"
    assert d["specs"] == {"caliber": ".308"}


def test_parts_catalog_and_builds(client):
    cat = client.get("/api/parts-catalog").json()
    assert len(cat["parts"]) > 500 and len(cat["acc"]) > 400
    guns = {g["id"]: g for g in client.get("/api/library").json()["guns"]}
    # every gun has a build the 3D engine can draw; only added parts change the price
    for g in guns.values():
        assert g["platform"] in ("ar15", "ar10", "pistol", "1522") and g["cfg"] and g["build"]
        assert not any(l["kind"] == "upgrade" for l in g["pricing"]["lines"])
    gid = DD
    before = guns[gid]["pricing"]["total"]
    build = guns[gid]["build"]
    trig = next(r for r in build if r["slot"] == "trigger")
    trig.update({"name": "LaRue MBT-2S", "source": "upgrade", "listPrice": 135, "status": "planned",
                 "factory": {"name": trig["name"]}})
    g = client.patch(f"/api/guns/{gid}", json={"build": build}).json()
    line = next(l for l in g["pricing"]["lines"] if l["kind"] == "upgrade")
    assert line["id"] == "trigger" and line["price"] == 135 and line["priceSource"] == "catalog"
    assert g["pricing"]["planned"] == 135 and g["pricing"]["total"] == round(before + 135, 2)
    a = client.get("/api/analytics").json()["cost"]
    row = next(r for r in a["byGun"] if r["id"] == gid)
    assert row["planned"] == 135
    # bad input is refused
    assert client.patch(f"/api/guns/{gid}", json={"build": [{"slot": "trigger", "name": "x", "pid": "nope"}]}).status_code == 400
    assert client.patch(f"/api/guns/{gid}", json={"build": [{"slot": "Bad Slot", "name": "x"}]}).status_code == 400
    assert client.patch(f"/api/guns/{gid}", json={"cfg": {"barrel": [1, 2]}}).status_code == 400
    assert client.patch(f"/api/guns/{gid}", json={"platform": "musket"}).status_code == 400


def test_new_gun_from_template_and_catalog_attachment(client):
    body = {"name": "Test SBR", "type": "rifle", "platform": "ar15", "caliber": "5.56 NATO", "cfg": {"barrel": 11.5, "gas": "carbine"},
            "build": [{"slot": "trigger", "label": "Trigger", "name": "ALG Defense ACT", "pid": "trigger-alg-defense-act-trigger",
                       "source": "upgrade", "listPrice": 69, "status": "planned"}], "status": "planned", "price": 0}
    cat = client.get("/api/parts-catalog").json()
    pid = next(p["id"] for p in cat["parts"] if p["s"] == "trigger")
    body["build"][0]["pid"] = pid
    gid = client.post("/api/guns", json=body).json()["id"]
    g = next(x for x in client.get("/api/library").json()["guns"] if x["id"] == gid)
    assert g["pricing"]["planned"] == 69
    cid = next(a["id"] for a in cat["acc"] if a["k"] == "reddot")
    r = client.post(f"/api/guns/{gid}/attachments", json={"type": "reddot", "name": "Dot", "cid": cid, "price": 300, "status": "planned"})
    assert r.status_code == 201
    assert client.post(f"/api/guns/{gid}/attachments", json={"type": "reddot", "name": "Dot", "cid": "nope"}).status_code == 400
    bad = dict(body, name="Bad", platform="musket")
    assert client.post("/api/guns", json=bad).status_code == 400


def test_attachment_placement_and_mount_price(client):
    gid = DD
    cat = client.get("/api/parts-catalog").json()
    lpvo = next(a for a in cat["acc"] if a["k"] == "lpvo")
    mount = next(a for a in cat["acc"] if a["k"] == "omount" and a.get("for") == "lpvo" and a.get("p"))
    aid = client.post(f"/api/guns/{gid}/attachments", json={"type": "lpvo", "name": "LPVO", "cid": lpvo["id"], "price": 500, "status": "planned"}).json()["id"]
    url = f"/api/guns/{gid}/attachments/{aid}"
    assert client.patch(url, json={"pos": -4.1, "mount": mount["id"]}).status_code == 200
    g = next(x for x in client.get("/api/library").json()["guns"] if x["id"] == gid)
    a = next(x for x in g["attachments"] if x["id"] == aid)
    assert a["pos"] == -4.1 and a["mount"] == mount["id"]
    line = next(l for l in g["pricing"]["lines"] if l["id"] == aid)
    assert line["price"] == round(500 + mount["p"], 2) and mount["n"] in line["label"]
    # back to the default spot removes the stored position
    assert client.patch(url, json={"pos": None}).status_code == 200
    g = next(x for x in client.get("/api/library").json()["guns"] if x["id"] == gid)
    assert "pos" not in next(x for x in g["attachments"] if x["id"] == aid)
    assert client.patch(url, json={"clock": 13}).status_code == 400
    assert client.patch(url, json={"mount": "nope"}).status_code == 400


def test_records_checks_and_cleaning(client):
    gid = DD
    rec = {"mfr": "Daniel Defense", "serial": "TEST123", "acquired": "2026-01-02", "paid": "1700", "scaleWeightLb": 6.9,
           "nfa": {"item": "none", "status": ""}}
    g = client.patch(f"/api/guns/{gid}", json={"records": rec, "cleanEvery": 300,
                                                "checks": [{"level": "check", "text": "Confirm the gas block is pinned"}]}).json()
    assert g["records"]["serial"] == "TEST123" and g["cleanEvery"] == 300
    assert client.patch(f"/api/guns/{gid}", json={"records": {"nfa": {"status": "maybe"}}}).status_code == 400
    assert client.patch(f"/api/guns/{gid}", json={"records": {"shoeSize": "9"}}).status_code == 400
    assert client.patch(f"/api/guns/{gid}", json={"checks": [{"level": "bad", "text": "x"}]}).status_code == 400
    assert client.patch(f"/api/guns/{gid}", json={"cleanEvery": 0}).status_code == 400
    for kind, rounds in (("range", 200), ("malfunction", None), ("range", 150)):
        r = client.post("/api/logs", json={"gun_id": gid, "kind": kind, "date": "2026-02-01", "title": kind, "amount": None,
                                           "rounds": rounds, "category": None, "vendor": None, "notes": ""})
        assert r.status_code in (200, 201)
    use = next(u for u in client.get("/api/analytics").json()["usage"]["byGun"] if u["id"] == gid)
    assert use["sinceCleaning"] == 350 and use["cleanEvery"] == 300 and use["cleaningDue"] and use["malfunctions"] == 1
    assert client.put("/api/settings", json={"units": "mm"}).json()["units"] == "mm"
    assert client.put("/api/settings", json={"units": "cubits"}).status_code == 400


def test_old_log_table_is_migrated(tmp_path, monkeypatch):
    import sqlite3
    from server import db
    path = tmp_path / "old.db"
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, gun_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('purchase','rounds','maintenance','range','nfa','note')), "
              "date TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', amount REAL, rounds INTEGER, category TEXT, vendor TEXT, notes TEXT NOT NULL DEFAULT '', receipt TEXT, created_at TEXT NOT NULL)")
    c.execute("INSERT INTO logs(gun_id, kind, date, created_at) VALUES('g', 'range', '2026-01-01', 'x')")
    c.commit(); c.close()
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_for_tests()
    try:
        with db.tx() as cx:
            cx.execute("INSERT INTO logs(gun_id, kind, date, created_at) VALUES('g', 'malfunction', '2026-01-02', 'x')")
        assert [r["kind"] for r in db.rows("SELECT kind FROM logs ORDER BY id")] == ["range", "malfunction"]
    finally:
        db.reset_for_tests()


def test_undo_duplicate_reorder(client):
    gid = G17
    before = next(g for g in client.get("/api/library").json()["guns"] if g["id"] == gid)
    client.patch(f"/api/guns/{gid}", json={"short": "Changed"})
    last = client.get("/api/history/last").json()["change"]
    assert last["gunId"] == gid and "short" in last["fields"]
    assert client.post("/api/history/undo").status_code == 200
    after = next(g for g in client.get("/api/library").json()["guns"] if g["id"] == gid)
    assert after["short"] == before["short"]
    # duplicate copies the build but not receipts; it goes to the end
    new = client.post(f"/api/guns/{gid}/duplicate").json()["id"]
    guns = client.get("/api/library").json()["guns"]
    copy = next(g for g in guns if g["id"] == new)
    assert copy["name"].endswith("(copy)") and copy["build"] == before["build"] and guns[-1]["id"] == new
    ids = [g["id"] for g in guns]
    ids.insert(0, ids.pop())
    assert client.put("/api/library/order", json={"ids": ids}).status_code == 200
    assert client.get("/api/library").json()["guns"][0]["id"] == new
    assert client.put("/api/library/order", json={"ids": ids[:2]}).status_code == 400
    # reorder isn't an undo step
    last = client.get("/api/history/last").json()["change"]
    assert last is None or "order" not in last["fields"]


def test_export_import_and_csv(client):
    client.post("/api/logs", json={"gun_id": DD, "kind": "range", "date": "2026-03-01", "title": "Zero",
                                   "amount": None, "rounds": 60, "category": None, "vendor": None, "notes": ""})
    r = client.get("/api/export.json")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["format"] == "ironworks" and len(data["guns"]) == 2
    n = len(client.get("/api/library").json()["guns"])
    res = client.post("/api/import", json={**data, "guns": data["guns"][:1]}).json()
    assert len(res["created"]) == 1 and res["logs"] == 1
    assert len(client.get("/api/library").json()["guns"]) == n + 1
    assert client.post("/api/import", json={"format": "other"}).status_code == 400
    assert client.post("/api/import", content=b"not json", headers={"content-type": "application/json"}).status_code == 400
    csv_text = client.get("/api/export.csv").text
    assert csv_text.splitlines()[0].lstrip("\ufeff").startswith("Name,")
    client.patch(f"/api/guns/{DD}", json={"short": "=HYPERLINK(1)"})
    assert "'=HYPERLINK" in client.get("/api/export.csv").text


def test_network_access_needs_a_password_and_sign_in(client, monkeypatch):
    from server import access
    # settings never send the password hash to the page
    assert client.get("/api/settings").json()["network"] == {"lan": False, "hasPassword": False}
    assert client.put("/api/settings", json={"network": {"lan": True}}).status_code == 400          # no password yet
    assert client.put("/api/settings", json={"network": {"password": "short"}}).status_code == 400  # too short
    s = client.put("/api/settings", json={"network": {"password": "correct horse", "lan": True}}).json()
    assert s["network"] == {"lan": True, "hasPassword": True} and "hash" not in str(s)
    assert client.get("/api/network").json()["restartNeeded"] is True   # still listening on 127.0.0.1 only

    # now act as another device on the network
    monkeypatch.setattr(access, "is_local", lambda ip: False)
    assert client.get("/api/library").status_code == 401
    r = client.get("/gun/x", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/login")
    assert "Sign in" in client.get("/login").text
    assert client.post("/login", data={"password": "wrong one!"}).status_code == 401
    r = client.post("/login", data={"password": "correct horse", "next": "/"}, follow_redirects=False)
    assert r.status_code == 303 and access.COOKIE in r.cookies
    assert client.get("/api/library").status_code == 200          # signed in: the cookie works
    # other devices can't open the network up further or change the password
    assert client.put("/api/settings", json={"network": {"lan": False}}).status_code == 403
    # turning network access off signs everyone out and refuses other devices again
    monkeypatch.setattr(access, "is_local", lambda ip: True)
    client.put("/api/settings", json={"network": {"lan": False}})
    monkeypatch.setattr(access, "is_local", lambda ip: False)
    assert client.get("/api/library").status_code == 403


def test_unknown_host_names_are_refused(client):
    # blocks DNS rebinding: a website pointing its own name at this computer
    assert client.get("/api/library", headers={"host": "evil.example"}).status_code == 400
    assert client.get("/api/library", headers={"host": "127.0.0.1:8080"}).status_code == 200


def test_old_database_name_is_adopted(tmp_path, monkeypatch):
    from server import db
    old, new = tmp_path / "workbench.db", tmp_path / "ironworks.db"
    old.write_bytes(b"")
    monkeypatch.setattr(db, "OLD_DB", old)
    monkeypatch.setattr(db, "DB_PATH", new)
    monkeypatch.setattr(db, "DATA_DB", new)
    db._adopt_old_db()
    assert new.exists() and not old.exists()
