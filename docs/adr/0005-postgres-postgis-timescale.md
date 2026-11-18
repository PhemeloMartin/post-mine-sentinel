# ADR-0005: PostgreSQL 16 with PostGIS and TimescaleDB

**Status:** Accepted · **Date:** 2026-11-18

## Context

We need relational integrity (alerts, users, audit), spatial queries (sites within N km) and time-series ingest with retention.

## Decision

One PostgreSQL engine with the PostGIS and TimescaleDB extensions (both allow-listed on Azure Flexible Server). Alembic owns the schema; the PostgreSQL-specific DDL is applied in migration 0001.

## Alternatives considered

Separate time-series DB (InfluxDB) + Postgres; MongoDB; Cosmos DB.

## Consequences

+ One backup/HA story, SQL everywhere, ACID across facts and alerts. − Extension version management; SQLite tests cannot cover PostgreSQL-only DDL (covered by a CI job on TimescaleDB-HA).
