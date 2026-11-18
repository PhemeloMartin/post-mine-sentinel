# ADR-0001: Polyglot monorepo with shared contracts

**Status:** Accepted · **Date:** 2026-11-18

## Context

The system spans firmware, a high-throughput network service, data science, an enterprise workflow and a 3D web console. Each has a best-fit language and runtime.

## Decision

Use one repository with C++ (firmware), Go (ingest), Python (API + ML), C#/ASP.NET (cases) and TypeScript (console). Cross-language correctness is enforced through **shared test vectors**, not shared code: `protocol/test-vectors.json` (SilkNet, FIPS-197, RFC 3610) and ML golden vectors (Python → C++). CI regenerates vectors and fails on drift.

## Alternatives considered

Single-language stack (e.g. all Python); multi-repo with versioned packages.

## Consequences

+ Right tool per job; atomic changes across components; one CI. − More toolchains for contributors (mitigated by Docker, `Makefile`, `scripts/dev.ps1`).
