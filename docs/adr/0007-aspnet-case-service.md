# ADR-0007: ASP.NET Core for case and evidence management

**Status:** Accepted · **Date:** 2026-11-18

## Context

Case management is a rich, rules-heavy enterprise domain that must integrate with government systems, which commonly run on Microsoft/.NET stacks.

## Decision

A separate bounded context in C# / ASP.NET Core 10 with EF Core, an explicit state machine, per-item custody hash chains, ProblemDetails errors, and idempotent case creation from the API's transactional outbox.

## Alternatives considered

Extend the Python API; a low-code case tool.

## Consequences

+ Strong typing and analyzers (warnings as errors) for the evidence domain; independent scaling and deployment. − An extra service and an outbox to operate.
