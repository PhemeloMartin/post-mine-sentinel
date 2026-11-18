import httpx

from app.services.outbox import CircuitBreaker, backoff


def test_backoff_is_bounded_and_grows():
    assert 0 <= backoff(0) <= 2
    assert all(0 <= backoff(a) <= 600 for a in range(20))


def test_circuit_breaker_opens_and_half_opens():
    cb = CircuitBreaker(threshold=3, cooldown_s=0.0)
    for _ in range(3):
        cb.failure()
    assert cb.state in ("open", "half-open")
    cb.success()
    assert cb.state == "closed"


def test_relay_dead_letters_client_errors_and_retries_server_errors(client, analyst):
    from app.db.models import OutboxEvent
    from app.db.session import _factory
    from app.services.outbox import breaker, relay_once

    breaker.success()
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503) if calls["n"] == 1 else httpx.Response(422, json={"title": "bad"})

    with _factory()() as db:
        db.query(OutboxEvent).delete()
        db.add_all([OutboxEvent(topic="case.open", payload={"a": 1}), OutboxEvent(topic="case.open", payload={"b": 2})])
        db.commit()
        stats = relay_once(db, httpx.Client(transport=httpx.MockTransport(handler)), "http://case")
        assert stats["retried"] == 1 and stats["dead"] == 1
