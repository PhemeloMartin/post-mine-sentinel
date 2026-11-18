"""HTTP API v1. Every route is permission-guarded and every state change is audited."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, generate_latest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..core import audit, signing
from ..core.config import Settings, get_settings
from ..core.errors import NotFound, TooManyRequests, Unauthorized, UpstreamUnavailable
from ..core.rbac import MATRIX, Perm, Role, generalise
from ..core.security import hash_password, issue_access_token, needs_rehash, verify_password
from ..db.models import Alert, AuditLog, Mine, Site, User
from ..db.session import get_db
from ..deps import Principal, current_principal, require, service_auth
from ..schemas import (
    AlertOut,
    AuditVerify,
    FusionResult,
    LoginRequest,
    Me,
    MineOut,
    Page,
    PlanOut,
    PlanRequest,
    TokenResponse,
    WindowBatch,
)
from ..services import fusion

router = APIRouter(prefix="/api/v1")

WINDOWS_INGESTED = Counter("sentinel_windows_ingested_total", "Fused 4-second windows", ["site"])
ALERTS_RAISED = Counter("sentinel_alerts_raised_total", "Alerts raised", ["level"])
LOGIN_FAILURES = Counter("sentinel_login_failures_total", "Failed sign-in attempts")

# --------------------------------------------------------------------------- health


@router.get("/health", tags=["ops"])
def health() -> dict:
    return {"status": "ok", "service": "sentinel-api", "time": datetime.now(UTC).isoformat()}


@router.get("/ready", tags=["ops"])
def ready(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 - readiness must report, not crash
        raise UpstreamUnavailable("Database not reachable.") from exc
    return {"status": "ready"}


@router.get("/metrics", include_in_schema=False)
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# --------------------------------------------------------------------------- auth

_attempts: dict[str, deque[float]] = defaultdict(deque)
RATE_WINDOW_S, RATE_MAX = 60.0, 10


def _rate_limit(key: str) -> None:
    """Sliding-window limiter (per client IP). Redis-backed in multi-replica deployments."""
    now = time.monotonic()
    q = _attempts[key]
    while q and now - q[0] > RATE_WINDOW_S:
        q.popleft()
    if len(q) >= RATE_MAX:
        raise TooManyRequests("Too many sign-in attempts. Wait a minute and try again.",
                              headers={"Retry-After": str(int(RATE_WINDOW_S))})
    q.append(now)


@router.post("/auth/login", response_model=TokenResponse, tags=["auth"])
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db),
          settings: Settings = Depends(get_settings)) -> TokenResponse:
    ip = request.client.host if request.client else "unknown"
    _rate_limit(ip)
    user = db.execute(select(User).where(User.username == body.username)).scalar_one_or_none()
    now = datetime.now(UTC)
    locked = user is not None and user.locked_until is not None and \
        (user.locked_until if user.locked_until.tzinfo else user.locked_until.replace(tzinfo=UTC)) > now
    ok = verify_password(user.password_hash if user else None, body.password)  # always hash: no timing oracle
    if user is None or not user.is_active or locked or not ok:
        LOGIN_FAILURES.inc()
        if user is not None and not locked:
            user.failed_logins += 1
            if user.failed_logins >= settings.login_max_failures:
                user.locked_until = now + timedelta(minutes=settings.login_lockout_minutes)
                user.failed_logins = 0
        audit.record(db, actor=body.username, role=user.role if user else "unknown", action="auth.login",
                     resource="session", outcome="deny", ip=ip)
        db.commit()
        # Identical message for unknown user, wrong password and locked account (no enumeration).
        raise Unauthorized("Sign-in failed.")
    user.failed_logins, user.locked_until = 0, None
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    org = user.organisation.name if user.organisation else None
    token, ttl = issue_access_token(settings, subject=user.username, role=user.role, org=org)
    audit.record(db, actor=user.username, role=user.role, action="auth.login", resource="session", ip=ip)
    db.commit()
    return TokenResponse(access_token=token, expires_in=ttl, role=user.role, display_name=user.display_name)


@router.get("/auth/me", response_model=Me, tags=["auth"])
def me(p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> Me:
    user = db.execute(select(User).where(User.username == p.username)).scalar_one_or_none()
    if user is None or not user.is_active:
        raise Unauthorized("Account disabled.")
    return Me(username=user.username, display_name=user.display_name, role=user.role,
              permissions=sorted(x.value for x in MATRIX[Role(user.role)]))


# --------------------------------------------------------------------------- mines


def _mine_out(m: Mine, p: Principal) -> MineOut:
    precise = p.can(Perm.PRECISE_LOCATION)
    intel = p.can(Perm.VIEW_ALL) or precise
    lat, lon = (m.lat, m.lon) if precise else generalise(m.lat, m.lon)
    return MineOut(
        id=m.id, name=m.name, commodity=m.commodity, province=m.province, locality=m.locality, lat=lat, lon=lon,
        precision_m=m.precision_m if precise else 5000, location_generalised=not precise, status=m.status,
        opened=m.opened, closed=m.closed, method=m.method, max_depth_m=m.max_depth_m, production=m.production,
        residual=m.residual,
        rai=m.rai if intel else None, rai_band=m.rai_band if intel else None,
        rai_contributions=m.rai_contributions if intel else None,
        illegal_reported=m.illegal_reported if intel else None, notes=m.notes if intel else None,
    )


@router.get("/mines", response_model=Page[MineOut], tags=["register"])
def list_mines(
    province: str | None = Query(default=None, max_length=4),
    commodity: str | None = Query(default=None, max_length=24),
    band: str | None = Query(default=None, pattern="^(low|elevated|high|critical)$"),
    min_rai: float = Query(default=0, ge=0, le=100),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
) -> Page[MineOut]:
    q = select(Mine)
    if province:
        q = q.where(Mine.province == province.upper())
    if commodity:
        q = q.where(Mine.commodity == commodity.lower())
    if band and p.can(Perm.VIEW_ALL):
        q = q.where(Mine.rai_band == band)
    if min_rai and p.can(Perm.VIEW_ALL):
        q = q.where(Mine.rai >= min_rai)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.execute(q.order_by(Mine.rai.desc()).limit(limit).offset(offset)).scalars().all()
    return Page[MineOut](items=[_mine_out(m, p) for m in rows], total=total, limit=limit, offset=offset)


@router.get("/mines/{mine_id}", response_model=MineOut, tags=["register"])
def get_mine(mine_id: str, request: Request, p: Principal = Depends(current_principal),
             db: Session = Depends(get_db)) -> MineOut:
    m = db.get(Mine, mine_id)
    if m is None:
        raise NotFound(f"Mine {mine_id} not found.")
    if p.can(Perm.PRECISE_LOCATION):  # viewing exact coordinates of a site is itself audited
        audit.record(db, actor=p.username, role=p.role, action="site.precise_location", resource=mine_id,
                     ip=request.client.host if request.client else None)
        db.commit()
    return _mine_out(m, p)


# --------------------------------------------------------------------------- sites & ingest


@router.get("/sites", tags=["sensing"])
def list_sites(p: Principal = Depends(require(Perm.LIVE_ALERTS)), db: Session = Depends(get_db)) -> list[dict]:
    out = []
    for s in db.execute(select(Site)).scalars():
        statuses: dict[str, int] = defaultdict(int)
        for n in s.nodes:
            statuses[n.status] += 1
        out.append({"mineId": s.mine_id, "name": s.mine.name, "hub": s.hub, "phase": s.phase, "prior": s.prior,
                    "nodes": len(s.nodes), "nodeStatus": dict(statuses)})
    return out


@router.post("/ingest/windows", response_model=FusionResult, tags=["sensing"])
def ingest_windows(batch: WindowBatch, actor: str = Depends(service_auth), db: Session = Depends(get_db)) -> FusionResult:
    result = fusion.ingest_window(db, batch, actor)
    WINDOWS_INGESTED.labels(site=batch.mine_id).inc()
    if result.alert_ref and result.posterior >= fusion.ALERT_P:
        ALERTS_RAISED.labels(level="critical" if result.posterior >= fusion.CRITICAL_P else "high").inc()
    return result


# --------------------------------------------------------------------------- alerts


def _alert_out(a: Alert) -> AlertOut:
    return AlertOut(ref=a.ref, status=a.status, level=a.level, posterior=a.posterior, reason=a.reason, tamper=a.tamper,
                    raised_at=a.raised_at, acknowledged_at=a.acknowledged_at, acknowledged_by=a.acknowledged_by,
                    dispatched_at=a.dispatched_at, resolved_at=a.resolved_at, case_ref=a.case_ref,
                    signature=a.signature, mine_id=a.site.mine_id)


@router.get("/alerts", response_model=list[AlertOut], tags=["alerts"])
def list_alerts(status: str | None = Query(default=None, pattern="^(raised|acknowledged|dispatched|resolved)$"),
                p: Principal = Depends(require(Perm.LIVE_ALERTS)), db: Session = Depends(get_db)) -> list[AlertOut]:
    q = select(Alert).order_by(Alert.raised_at.desc()).limit(200)
    if status:
        q = q.where(Alert.status == status)
    return [_alert_out(a) for a in db.execute(q).scalars()]


@router.post("/alerts/{ref}/acknowledge", response_model=AlertOut, tags=["alerts"])
def acknowledge(ref: str, p: Principal = Depends(require(Perm.LIVE_ALERTS)), db: Session = Depends(get_db)) -> AlertOut:
    return _alert_out(fusion.acknowledge(db, ref, p.username, p.role))


@router.post("/alerts/{ref}/dispatch", response_model=AlertOut, tags=["alerts"])
def dispatch(ref: str, p: Principal = Depends(require(Perm.LIVE_ALERTS)), db: Session = Depends(get_db)) -> AlertOut:
    return _alert_out(fusion.dispatch(db, ref, p.username, p.role))


@router.get("/alerts/{ref}/verify", tags=["alerts"])
def verify_alert(ref: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    a = db.execute(select(Alert).where(Alert.ref == ref)).scalar_one_or_none()
    if a is None:
        raise NotFound(f"Alert {ref} not found.")
    # Anyone (court, auditor) can re-verify offline with the published public key.
    return {"ref": a.ref, "valid": signing.verify(a.signed_payload, a.signature), "algorithm": "Ed25519",
            "publicKey": signing.public_key_hex(), "signature": a.signature, "payload": a.signed_payload}


# --------------------------------------------------------------------------- planning


@router.post("/planning/route", response_model=PlanOut, tags=["planning"])
def plan_route(body: PlanRequest, p: Principal = Depends(require(Perm.PLAN_INSPECTIONS)),
               db: Session = Depends(get_db)) -> PlanOut:
    from sentinel_ml.geo import haversine_m
    from sentinel_ml.planning import Site as PSite
    from sentinel_ml.planning import build_selection_qubo, qaoa_statevector, solve_exact, solve_heuristic, travel_matrix

    mines = db.execute(select(Mine).where(Mine.status.not_in(["operating", "rehabilitated"]))).scalars().all()
    cands = [m for m in mines if haversine_m(body.depot_lat, body.depot_lon, m.lat, m.lon) / 1000 <= body.radius_km]
    cands.sort(key=lambda m: -m.rai)
    cands = cands[: body.max_sites]
    sites = [PSite(m.id, m.lat, m.lon, m.rai / 10, 1.5 if m.method == "underground" else 1.0) for m in cands]
    t = travel_matrix((body.depot_lat, body.depot_lon), sites)
    if body.solver == "exact":
        if len(sites) > 14:
            sites, cands = sites[:14], cands[:14]
            t = travel_matrix((body.depot_lat, body.depot_lon), sites)
        plan = solve_exact(sites, t, body.budget_hours)
        return PlanOut(solver="exact-dp", route=plan.ids(sites), value=plan.value, duration_hours=plan.duration_h,
                       candidates=len(sites), notes="Held–Karp DP over the 14 highest-risk candidates.")
    if body.solver == "qaoa":
        sub = sites[:8]
        costs = [s.service_h + 2 * t[0, i + 1] for i, s in enumerate(sub)]
        prob = build_selection_qubo([s.value for s in sub], costs, body.budget_hours)
        res = qaoa_statevector(prob, p=2, restarts=3)
        chosen, value, cost, _ = prob.decode(res["bitstring"])
        return PlanOut(solver="qaoa-statevector", route=[sub[i].id for i in chosen], value=value, duration_hours=cost,
                       candidates=len(sub), notes=f"Selection QUBO, {prob.n} qubits, approx. ratio "
                                                  f"{res['approximation_ratio']:.2f}; route order not optimised.")
    plan = solve_heuristic(sites, t, body.budget_hours, iterations=120)
    return PlanOut(solver="heuristic-ils", route=plan.ids(sites), value=plan.value, duration_hours=plan.duration_h,
                   candidates=len(sites))


# --------------------------------------------------------------------------- audit


@router.get("/audit", tags=["audit"])
def list_audit(limit: int = Query(default=100, ge=1, le=500), p: Principal = Depends(require(Perm.VIEW_AUDIT)),
               db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(AuditLog).order_by(AuditLog.seq.desc()).limit(limit)).scalars()
    return [{"seq": r.seq, "at": r.at, "actor": r.actor, "role": r.role, "action": r.action, "resource": r.resource,
             "outcome": r.outcome, "hash": r.hash, "prev": r.prev_hash} for r in rows]


@router.get("/audit/verify", response_model=AuditVerify, tags=["audit"])
def verify_audit(p: Principal = Depends(require(Perm.VIEW_AUDIT)), db: Session = Depends(get_db)) -> AuditVerify:
    ok, bad, n = audit.verify(db)
    return AuditVerify(ok=ok, first_bad_seq=bad, entries=n)
