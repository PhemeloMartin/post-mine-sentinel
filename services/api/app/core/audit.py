"""Tamper-evident, append-only audit trail.

    h₀ = SHA-256("GENESIS"),   hᵢ = SHA-256(hᵢ₋₁ ‖ canonical_json(entryᵢ))

Canonical JSON = sorted keys, compact separators (identical to the web console's
``auditChain.ts`` so an auditor can verify the log in the browser or on the server).
In PostgreSQL the table is additionally protected by a trigger that rejects UPDATE and
DELETE (see infra/db/init/010_postgis_timescale.sql) and is replicated to WORM storage.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import AuditLog

GENESIS = hashlib.sha256(b"GENESIS").hexdigest()


def canonical(entry: dict) -> str:
    return json.dumps(entry, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _digest(prev: str, entry: dict) -> str:
    return hashlib.sha256((prev + canonical(entry)).encode("utf-8")).hexdigest()


def _body(row: AuditLog) -> dict:
    return {"seq": row.seq, "at": row.at, "actor": row.actor, "role": row.role, "action": row.action,
            "resource": row.resource, "outcome": row.outcome}


def record(db: Session, *, actor: str, role: str, action: str, resource: str, outcome: str = "allow",
           ip: str | None = None) -> AuditLog:
    """Append one entry. Callers commit as part of their own transaction (atomic with the action)."""
    last = db.execute(select(AuditLog).order_by(AuditLog.seq.desc()).limit(1).with_for_update()).scalar_one_or_none()
    prev = last.hash if last else GENESIS
    seq = (last.seq + 1) if last else 1
    row = AuditLog(seq=seq, at=datetime.now(UTC).isoformat(timespec="seconds"), actor=actor, role=role,
                   action=action, resource=resource, outcome=outcome, ip=ip, prev_hash=prev, hash="")
    row.hash = _digest(prev, _body(row))
    db.add(row)
    db.flush()
    return row


def verify(db: Session) -> tuple[bool, int | None, int]:
    """Return (ok, first_bad_seq, entries_checked)."""
    prev = GENESIS
    count = 0
    for row in db.execute(select(AuditLog).order_by(AuditLog.seq)).scalars():
        count += 1
        if row.prev_hash != prev or _digest(prev, _body(row)) != row.hash:
            return False, row.seq, count
        prev = row.hash
    return True, None, count
