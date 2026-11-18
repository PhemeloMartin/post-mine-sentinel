"""Outbox relay: delivers committed events to the ASP.NET case service.

Resilience patterns (docs/16-error-handling.md):
* at-least-once delivery with an idempotency key (the case service de-duplicates on it),
* exponential back-off with jitter between attempts,
* a circuit breaker so a down case service is not hammered,
* dead-lettering after ``MAX_ATTEMPTS`` with the last error kept for operators.
"""

from __future__ import annotations

import logging
import random
import time
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import OutboxEvent

log = logging.getLogger("sentinel.outbox")
MAX_ATTEMPTS = 8


class CircuitBreaker:
    """Closed → (N consecutive failures) → Open → (cool-down) → Half-open → Closed/Open."""

    def __init__(self, threshold: int = 5, cooldown_s: float = 30.0):
        self.threshold, self.cooldown_s = threshold, cooldown_s
        self.failures = 0
        self.opened_at: float | None = None

    @property
    def state(self) -> str:
        if self.opened_at is None:
            return "closed"
        return "half-open" if time.monotonic() - self.opened_at >= self.cooldown_s else "open"

    def allow(self) -> bool:
        return self.state != "open"

    def success(self) -> None:
        self.failures, self.opened_at = 0, None

    def failure(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold or self.state == "half-open":
            self.opened_at = time.monotonic()


breaker = CircuitBreaker()


def backoff(attempt: int, base_s: float = 2.0, cap_s: float = 600.0) -> float:
    return random.uniform(0, min(cap_s, base_s * 2 ** attempt))  # noqa: S311 - jitter, not crypto


def relay_once(db: Session, client: httpx.Client, base_url: str, batch: int = 20) -> dict[str, int]:
    stats = {"sent": 0, "retried": 0, "dead": 0, "skipped": 0}
    now = datetime.now(UTC)
    rows = db.execute(
        select(OutboxEvent).where(OutboxEvent.status == "pending", OutboxEvent.next_attempt_at <= now)
        .order_by(OutboxEvent.id).limit(batch)
    ).scalars().all()
    for ev in rows:
        if not breaker.allow():
            stats["skipped"] += 1
            continue
        try:
            resp = client.post(f"{base_url}/api/cases", json=ev.payload,
                               headers={"Idempotency-Key": f"outbox-{ev.id}"}, timeout=5.0)
            if resp.status_code >= 500 or resp.status_code == 429:
                raise httpx.HTTPStatusError("retryable", request=resp.request, response=resp)
            if resp.status_code >= 400:  # a 4xx will never succeed: dead-letter immediately
                ev.status, ev.last_error = "dead", f"HTTP {resp.status_code}: {resp.text[:500]}"
                stats["dead"] += 1
            else:
                ev.status = "sent"
                stats["sent"] += 1
            breaker.success()
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            breaker.failure()
            ev.attempts += 1
            ev.last_error = str(exc)[:500]
            if ev.attempts >= MAX_ATTEMPTS:
                ev.status = "dead"
                stats["dead"] += 1
                log.error("outbox event dead-lettered", extra={"event_id": ev.id, "error": ev.last_error})
            else:
                ev.next_attempt_at = now + timedelta(seconds=backoff(ev.attempts))
                stats["retried"] += 1
    db.commit()
    return stats
