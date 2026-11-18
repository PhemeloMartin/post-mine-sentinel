# ADR-0009: Physics-informed synthetic data until field data exists

**Status:** Accepted · **Date:** 2026-11-18

## Context

No public labelled dataset of seismic signatures at South African derelict shafts exists.

## Decision

Generate training data from first-principles propagation models with literature-based parameter ranges, evaluate under explicit **domain shift**, publish the gap honestly, and replace or fine-tune with Phase-1 field recordings.

## Alternatives considered

Wait for field data (blocks all progress); borrow environmental-sound datasets (wrong modality and licences).

## Consequences

+ End-to-end pipeline ready now; parity tests protect the firmware. − Real-world accuracy unknown until the pilot (11.8 % false alarms under the simulated shift).
