from datetime import UTC, datetime, timedelta

from conftest import PASSWORD, SERVICE

PROBLEM = "application/problem+json"


# ----------------------------------------------------------------- ops & errors


def test_health_and_security_headers(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert len(r.headers["X-Request-ID"]) >= 16


def test_request_id_is_propagated(client):
    r = client.get("/api/v1/health", headers={"X-Request-ID": "trace-abc-123"})
    assert r.headers["X-Request-ID"] == "trace-abc-123"


def test_unknown_route_is_problem_json(client):
    r = client.get("/api/v1/nope")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith(PROBLEM)
    body = r.json()
    assert body["status"] == 404 and body["type"].endswith("/not-found") and body["traceId"]


def test_validation_error_lists_fields(client):
    r = client.post("/api/v1/auth/login", json={"username": "ab", "password": "short"})
    assert r.status_code == 422
    assert r.headers["content-type"].startswith(PROBLEM)
    assert {"username", "password"} <= set(r.json()["errors"])


def test_missing_token_is_401_problem(client):
    r = client.get("/api/v1/mines")
    assert r.status_code == 401 and r.headers["content-type"].startswith(PROBLEM)


# ----------------------------------------------------------------- auth


def test_login_failure_is_generic_and_audited(client, auditor):
    bad = client.post("/api/v1/auth/login", json={"username": "officer", "password": "wrong-password"})
    unknown = client.post("/api/v1/auth/login", json={"username": "nobody-here", "password": "wrong-password"})
    assert bad.status_code == unknown.status_code == 401
    assert bad.json()["detail"] == unknown.json()["detail"]  # no username enumeration
    log = client.get("/api/v1/audit?limit=20", headers=auditor).json()
    assert any(e["action"] == "auth.login" and e["outcome"] == "deny" for e in log)


def test_account_locks_after_repeated_failures(client):
    for _ in range(5):
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "not-the-password"})
    # Correct password is now rejected until the lockout expires.
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": PASSWORD})
    assert r.status_code == 401


def test_login_is_rate_limited_per_client(client):
    codes = [client.post("/api/v1/auth/login", json={"username": "nobody-here", "password": "wrong-password"}).status_code
             for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429


def test_tampered_token_rejected(client, analyst):
    token = analyst["Authorization"].split()[1]
    forged = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401


def test_me_lists_permissions(client, analyst):
    r = client.get("/api/v1/auth/me", headers=analyst)
    assert r.status_code == 200 and "precise_location" in r.json()["permissions"]


# ----------------------------------------------------------------- register & RBAC


def test_mines_are_ranked_and_filterable(client, analyst):
    r = client.get("/api/v1/mines?province=NW&limit=5", headers=analyst)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 5 and all(m["province"] == "NW" for m in body["items"])
    rais = [m["rai"] for m in body["items"]]
    assert rais == sorted(rais, reverse=True)


def test_liaison_gets_generalised_locations_and_no_intel(client, analyst, liaison):
    precise = client.get("/api/v1/mines/ZA-NW-002", headers=analyst).json()
    coarse = client.get("/api/v1/mines/ZA-NW-002", headers=liaison).json()
    assert precise["location_generalised"] is False and coarse["location_generalised"] is True
    assert coarse["rai"] is None and coarse["illegal_reported"] is None
    assert abs(coarse["lat"] * 20 - round(coarse["lat"] * 20)) < 1e-6  # snapped to 0.05° grid


def test_forbidden_is_problem_json_and_audited(client, liaison, auditor):
    r = client.get("/api/v1/alerts", headers=liaison)
    assert r.status_code == 403 and r.headers["content-type"].startswith(PROBLEM)
    log = client.get("/api/v1/audit?limit=10", headers=auditor).json()
    assert any(e["outcome"] == "deny" and e["action"] == "perm.live_alerts" for e in log)


# ----------------------------------------------------------------- ingest, fusion, alerts


def _batch(window: datetime, counter_base: int, kind: str = "seismic", p: float = 0.95, nodes=("S05", "S10", "S21")):
    return {
        "mine_id": "ZA-NW-002",
        "window_start": window.isoformat(),
        "votes": [
            {"node": n, "kind": kind, "cls": "footsteps" if kind == "seismic" else "animal", "p_threat": p,
             "snr_db": 22.0, "arrival_offset_ms": 120.0 + i * 15, "frame_counter": counter_base + i, "gateway": "A1"}
            for i, n in enumerate(nodes)
        ],
    }


def test_ingest_requires_service_token(client):
    r = client.post("/api/v1/ingest/windows", json=_batch(datetime.now(UTC), 1))
    assert r.status_code == 401


def test_benign_windows_never_alert(client):
    t0 = datetime.now(UTC)
    for k in range(6):
        r = client.post("/api/v1/ingest/windows", headers=SERVICE,
                        json=_batch(t0 + timedelta(seconds=4 * k), 100 + 10 * k, kind="benign", p=0.05,
                                    nodes=("S06", "S07", "S08")))
        assert r.status_code == 200
        assert r.json()["alert_ref"] is None


def test_threat_windows_raise_signed_alert_after_persistence(client, analyst):
    t0 = datetime.now(UTC)
    first = client.post("/api/v1/ingest/windows", headers=SERVICE, json=_batch(t0, 1000)).json()
    assert first["posterior"] > 0.9 and first["alert_ref"] is None   # persistence gate: one window is not enough
    second = client.post("/api/v1/ingest/windows", headers=SERVICE, json=_batch(t0 + timedelta(seconds=4), 1010)).json()
    ref = second["alert_ref"]
    assert ref and ref.startswith("ALR-")
    v = client.get(f"/api/v1/alerts/{ref}/verify", headers=analyst).json()
    assert v["valid"] is True and v["algorithm"] == "Ed25519"
    # Lifecycle: acknowledge → dispatch (outbox event) → cannot acknowledge twice.
    assert client.post(f"/api/v1/alerts/{ref}/acknowledge", headers=analyst).json()["status"] == "acknowledged"
    again = client.post(f"/api/v1/alerts/{ref}/acknowledge", headers=analyst)
    assert again.status_code == 409 and again.headers["content-type"].startswith(PROBLEM)
    assert client.post(f"/api/v1/alerts/{ref}/dispatch", headers=analyst).json()["status"] == "dispatched"


def test_replayed_frames_are_rejected(client):
    t0 = datetime.now(UTC)
    client.post("/api/v1/ingest/windows", headers=SERVICE, json=_batch(t0, 5000, nodes=("S12",)))
    replay = client.post("/api/v1/ingest/windows", headers=SERVICE, json=_batch(t0, 5000, nodes=("S12",))).json()
    assert replay["accepted_votes"] == 0 and replay["duplicate_votes"] == 1


def test_unknown_node_is_404(client):
    r = client.post("/api/v1/ingest/windows", headers=SERVICE, json=_batch(datetime.now(UTC), 9000, nodes=("S99",)))
    assert r.status_code == 404


# ----------------------------------------------------------------- planning & audit


def test_planning_heuristic_respects_budget(client, analyst):
    r = client.post("/api/v1/planning/route", headers=analyst,
                    json={"depot_lat": -26.85, "depot_lon": 26.67, "budget_hours": 6, "solver": "heuristic"})
    assert r.status_code == 200
    body = r.json()
    assert body["route"] and body["duration_hours"] <= 6 + 1e-9


def test_planning_forbidden_for_field_officer(client):
    from conftest import login

    officer = login(client, "officer")
    r = client.post("/api/v1/planning/route", headers=officer,
                    json={"depot_lat": -26.85, "depot_lon": 26.67, "budget_hours": 6})
    assert r.status_code == 403


def test_audit_chain_verifies_and_detects_tampering(client, auditor):
    assert client.get("/api/v1/audit/verify", headers=auditor).json()["ok"] is True
    from sqlalchemy import update

    from app.db.models import AuditLog
    from app.db.session import _factory

    with _factory()() as db:  # simulate an insider editing history directly in the database
        db.execute(update(AuditLog).where(AuditLog.seq == 2).values(actor="mallory"))
        db.commit()
    res = client.get("/api/v1/audit/verify", headers=auditor).json()
    assert res["ok"] is False and res["first_bad_seq"] == 2
