# 15. Error-handling strategy

**Principle:** in a safety system, errors must be **contained** (one failure does not cascade), **visible** (observable and traceable), **recoverable** (retry, fallback, replay) and **safe** (fail closed on security, fail operational on sensing). Every layer applies the same contract.

## 15.1 Error contract

| Layer | Expected errors | Unexpected errors |
|---|---|---|
| HTTP APIs (FastAPI, ASP.NET) | RFC 7807 `application/problem+json` with stable `type` URI, `title`, `status`, `detail`, `traceId`, plus `errors{field: [msgs]}` for validation | Generic 500 problem with `traceId`; full stack trace only in server logs |
| Go service | Wrapped errors (`fmt.Errorf("…: %w", err)`), sentinel errors (`ErrAuth`, `ErrShort`), `errors.Is/As` | Logged with `slog`; process keeps serving other frames |
| Firmware | `sentinel::Status` codes, `[[nodiscard]]`, no exceptions | Task watchdog → reset → crash-loop safe mode |
| Browser | Typed `ApiError` (from problem+json) → toast | React `ErrorBoundary` per region; global `unhandledrejection` handler |

## 15.2 Per component

**Python core API** (`app/core/errors.py`)
* `DomainError` hierarchy → 400/401/403/404/409/429/503 with precise slugs. `RequestValidationError` → 422 with a field map. Any other exception → logged with the request ID → safe 500.
* Database session rolled back on any exception (`get_db`). Readiness probe reports a DB outage as 503 instead of crashing.
* **Fail fast at boot:** refuses to start in prod without secrets or with SQLite.
* **Outbox relay:** retry with exponential back-off + full jitter; a **circuit breaker** stops hammering a down case service; 4xx responses are dead-lettered immediately (they will never succeed); 8 failed attempts → `dead` with the last error kept.

**ASP.NET case service** (`ProblemDetailsExceptionHandler`)
* A single `IExceptionHandler` maps `RequestValidationException`→400, `NotFoundException`→404, `DomainRuleException`→409, `DbUpdateConcurrencyException`→409 ("reload and retry"), unknown→500, using source-generated `LoggerMessage` logging.
* The domain enforces invariants (state machine, custody rules); invalid operations are impossible, not just discouraged.
* Npgsql `EnableRetryOnFailure` for transient faults; idempotency keys make retries safe.

**Go ingest** (`internal/pipeline`, `internal/sink`)
* **Fail closed:** frames that fail the AES-CCM MIC are dropped and counted, never parsed. The replay check runs only *after* authentication, so forgeries cannot poison the window.
* Every failure class has a metric (`auth_failed`, `malformed`, `replayed`, `duplicate`, `dead_lettered`, `circuit_open`) and a Prometheus alert.
* Delivery: 5 s timeout per request, exponential back-off with jitter, circuit breaker, **dead-letter file** (JSON lines, replayable).
* Graceful shutdown on SIGTERM flushes pending windows; the MQTT client reconnects with capped back-off; a zero keep-alive is guarded.
* Config is validated at startup (exit code 2 with a clear message).

**Firmware** (`src/main.cpp`)
* No key → never transmit. Counter cannot be persisted → never transmit (no nonce reuse).
* Duty-cycle exhausted → wait (never break the law). Channel busy → random back-off. TX failed → retry ×3 with back-off. No route → store and forward.
* Sensor timeout / saturation → status bits reported in heartbeats so faults are visible remotely.
* 8 s watchdog on every task; three abnormal resets → **safe mode** (heartbeats only, so the SOC sees the problem).

**Browser console**
* `apiFetch`: timeout via `AbortController`; retries only for network, 5xx and 429 errors (never 4xx); full-jitter back-off; problem+json parsed into a typed `ApiError`.
* The health probe switches automatically between **Live** and **Demo/offline** modes with a toast. Previously raised alerts remain visible.
* `ErrorBoundary` per page region (a crashed 3D scene does not take down the alert panel), with an incident ID and a "Reload view" button.
* WebGL capability check with a textual fallback. Storage access wrapped in try/catch (private mode). The simulation loop catches engine errors and halts with a visible message instead of freezing.

## 15.3 Verified by tests

`test_unknown_route_is_problem_json`, `test_validation_error_lists_fields`, `test_forbidden_is_problem_json_and_audited`, `test_login_is_rate_limited_per_client`, `test_relay_dead_letters_client_errors_and_retries_server_errors`, `test_circuit_breaker_opens_and_half_opens`, `Invalid_payload_returns_field_errors`, `Illegal_transition_is_409_problem`, `Unknown_case_is_404_problem`, `TestTamperedFramesFailClosed`, `TestForgedAndMalformedFramesAreRejected`, `TestShutdownFlushesPendingWindows`, `test_ccm_rejects_tampering_and_zeroes_output`, `test_frame_counter_never_repeats_across_reboots`, `test_feature_extraction_rejects_bad_input`.
