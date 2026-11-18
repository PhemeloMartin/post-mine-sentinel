# ADR-0008: Host on Azure, South Africa North

**Status:** Accepted · **Date:** 2026-11-18

## Context

POPIA s72 restricts cross-border transfers; government buyers prefer in-country hosting; the team needs managed Kubernetes, PostgreSQL and an HSM.

## Decision

Azure South Africa North (Johannesburg) with geo-backup to South Africa West (Cape Town). Terraform-managed.

## Alternatives considered

AWS af-south-1 (Cape Town); on-premises SITA data centres.

## Consequences

+ In-country data, managed HSM, AKS workload identity. − Cloud vendor lock-in (mitigated by Kubernetes, PostgreSQL and open protocols).
