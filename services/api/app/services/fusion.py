"""Server-side site fusion: the same Chair–Varshney window fusion as the digital twin.

    window LLR  = (Σ_seismic votes λᵢ) / √n_s + (Σ_pir votes λⱼ) / √n_p
    λ(threat)   = c · ln(DR/FAR),      c = 0.4 + 0.6·(p − θ)/(1 − θ)
    λ(benign)   = ln((1 − DR)/(1 − FAR))
    λ(pir)      = (1 if corroborated else 0.25) · ln(DR_pir/FAR_pir)

State (log-odds, persistence counter) is stored in ``site_beliefs`` with a row lock so
concurrent ingest batches for the same site serialise correctly across API replicas.
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core import audit, signing
from ..core.config import get_settings
from ..core.errors import NotFound
from ..db.models import Alert, Detection, OutboxEvent, SensorNode, Site, SiteBelief
from ..schemas import FusionResult, WindowBatch

ALERT_P = 0.90
CRITICAL_P = 0.97
PERSISTENCE_WINDOWS = 2
HALF_LIFE_S = 120.0
FLOOR_BELOW_PRIOR = 2.5
PIR_DR, PIR_FAR = 0.70, 0.05
TAMPER_DR, TAMPER_FAR = 0.90, 0.005


def logit(p: float) -> float:
    p = min(max(p, 1e-9), 1 - 1e-9)
    return math.log(p / (1 - p))


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x)) if x >= 0 else math.exp(x) / (1 + math.exp(x))


@lru_cache
def edge_model() -> tuple[float, float, float]:
    """(threshold, detection rate, false-alarm rate) from the published model card."""
    path = get_settings().data_dir.parent / "ml" / "artifacts" / "model_card.json"
    try:
        card = json.loads(path.read_text(encoding="utf-8"))
        test = card["evaluation"]["mlp_edge"]["test"]
        return float(card["alarm_threshold"]), float(test["detection_rate"]), max(float(test["false_alarm_rate"]), 0.005)
    except (OSError, KeyError, ValueError):
        return 0.5, 0.9, 0.02  # conservative fallback if the artefact is missing


def vote_llr(kind: str, p_threat: float, corroborated: bool) -> float:
    thr, dr, far = edge_model()
    if kind == "seismic":
        conf = 0.4 + 0.6 * min(1.0, max(0.0, (p_threat - thr) / (1 - thr)))
        return conf * math.log(dr / far)
    if kind == "benign":
        return math.log((1 - dr) / (1 - far))
    if kind == "pir":
        return (1.0 if corroborated else 0.25) * math.log(PIR_DR / PIR_FAR)
    if kind == "tamper":
        return math.log(TAMPER_DR / TAMPER_FAR)
    return 0.0


def _alert_ref(db: Session) -> str:
    n = (db.scalar(select(func.count()).select_from(Alert)) or 0) + 1
    return f"ALR-{datetime.now(UTC).year}-{n:06d}"


def ingest_window(db: Session, batch: WindowBatch, actor: str) -> FusionResult:
    site = db.execute(select(Site).where(Site.mine_id == batch.mine_id)).scalar_one_or_none()
    if site is None:
        raise NotFound(f"No monitored site for mine {batch.mine_id}.")
    belief = db.execute(select(SiteBelief).where(SiteBelief.site_id == site.id).with_for_update()).scalar_one()
    nodes = {n.id.split(":")[1]: n for n in site.nodes}
    now = datetime.now(UTC)

    accepted, duplicates = [], 0
    for v in batch.votes:
        node = nodes.get(v.node)
        if node is None:
            raise NotFound(f"Node {v.node} is not registered at {batch.mine_id}.")
        # Replay protection: frame counters must strictly increase per node.
        if v.frame_counter <= node.frame_counter and node.last_seen is not None:
            duplicates += 1
            continue
        node.frame_counter = v.frame_counter
        node.last_seen = now
        if v.kind == "tamper":
            node.status = "tampered"
        db.add(Detection(site_id=site.id, node_id=node.id, window_start=batch.window_start, kind=v.kind, cls=v.cls,
                         p_threat=v.p_threat, snr_db=v.snr_db, arrival_offset_ms=v.arrival_offset_ms,
                         frame_counter=v.frame_counter, gateway_id=v.gateway))
        accepted.append(v)

    # Decay towards the prior, then add the window's fused evidence.
    l0 = logit(site.prior)
    updated = belief.updated_at if belief.updated_at.tzinfo else belief.updated_at.replace(tzinfo=UTC)
    dt = max(0.0, (now - updated).total_seconds())
    log_odds = l0 + 2 ** (-dt / HALF_LIFE_S) * (belief.log_odds - l0)

    threat_nodes = {v.node for v in accepted if v.kind == "seismic"}
    seismic = [v for v in accepted if v.kind in ("seismic", "benign")]
    pir = [v for v in accepted if v.kind == "pir"]
    tamper = [v for v in accepted if v.kind == "tamper"]
    window_llr = 0.0
    if seismic:
        window_llr += sum(vote_llr(v.kind, v.p_threat, False) for v in seismic) / math.sqrt(len(seismic))
    if pir:
        window_llr += sum(vote_llr("pir", 1, v.node in threat_nodes) for v in pir) / math.sqrt(len(pir))
    window_llr += sum(vote_llr("tamper", 1, False) for _ in tamper)
    log_odds = max(log_odds + window_llr, l0 - FLOOR_BELOW_PRIOR)
    posterior = sigmoid(log_odds)

    belief.consecutive_high = belief.consecutive_high + 1 if posterior >= ALERT_P else 0
    belief.log_odds = log_odds
    belief.updated_at = now

    alert_ref = None
    open_alert = db.execute(select(Alert).where(Alert.site_id == site.id, Alert.status != "resolved")).scalar_one_or_none()
    if open_alert is None and posterior >= ALERT_P and (belief.consecutive_high >= PERSISTENCE_WINDOWS or tamper):
        reason = ", ".join(sorted({v.cls for v in accepted if v.kind in ("seismic", "tamper")})) or "fused evidence"
        alert = Alert(ref=_alert_ref(db), site_id=site.id, level="critical" if posterior >= CRITICAL_P else "high",
                      posterior=posterior, reason=reason[:255], tamper=bool(tamper), raised_at=now, signature="",
                      signed_payload={})
        alert.signed_payload = {"ref": alert.ref, "mine": batch.mine_id, "posterior": round(posterior, 6),
                                "reason": alert.reason, "raised_at": now.isoformat(), "tamper": alert.tamper,
                                "window_start": batch.window_start.isoformat(),
                                "evidence": sorted(f"{v.node}:{v.frame_counter}" for v in accepted)}
        alert.signature = signing.sign(alert.signed_payload)
        db.add(alert)
        audit.record(db, actor=actor, role="service", action="alert.raise", resource=alert.ref)
        alert_ref = alert.ref
    elif open_alert is not None:
        open_alert.posterior = max(open_alert.posterior, posterior)
        if posterior >= CRITICAL_P:
            open_alert.level = "critical"
        alert_ref = open_alert.ref
    db.commit()
    return FusionResult(site=batch.mine_id, posterior=posterior, log_odds=log_odds, window_llr=window_llr,
                        accepted_votes=len(accepted), duplicate_votes=duplicates, alert_ref=alert_ref)


def acknowledge(db: Session, ref: str, actor: str, role: str) -> Alert:
    alert = _get(db, ref)
    if alert.status != "raised":
        from ..core.errors import Conflict

        raise Conflict(f"Alert {ref} is already {alert.status}.")
    alert.status, alert.acknowledged_at, alert.acknowledged_by = "acknowledged", datetime.now(UTC), actor
    audit.record(db, actor=actor, role=role, action="alert.acknowledge", resource=ref)
    db.commit()
    return alert


def dispatch(db: Session, ref: str, actor: str, role: str) -> Alert:
    """Mark dispatched and enqueue a case-creation event in the same transaction (outbox)."""
    from ..core.errors import Conflict

    alert = _get(db, ref)
    if alert.status not in ("raised", "acknowledged"):
        raise Conflict(f"Alert {ref} cannot be dispatched from status {alert.status}.")
    alert.status, alert.dispatched_at = "dispatched", datetime.now(UTC)
    db.add(OutboxEvent(topic="case.open", payload={
        "alertRef": alert.ref, "mineId": alert.site.mine_id, "level": alert.level, "posterior": alert.posterior,
        "reason": alert.reason, "raisedAt": alert.raised_at.isoformat(), "signature": alert.signature,
        "requestedBy": actor,
    }))
    audit.record(db, actor=actor, role=role, action="alert.dispatch", resource=ref)
    db.commit()
    return alert


def _get(db: Session, ref: str) -> Alert:
    alert = db.execute(select(Alert).where(Alert.ref == ref)).scalar_one_or_none()
    if alert is None:
        raise NotFound(f"Alert {ref} not found.")
    return alert


def mark_node(db: Session, node_id: str) -> SensorNode:
    node = db.get(SensorNode, node_id)
    if node is None:
        raise NotFound(f"Node {node_id} not found.")
    return node
