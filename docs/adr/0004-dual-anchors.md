# ADR-0004: Two physically separated anchor gateways per site

**Status:** Accepted · **Date:** 2026-11-18

## Context

Syndicates can buy cheap 868 MHz jammers. Simulation E3: jamming the only anchor drops delivery to 49 %.

## Decision

Every site gets two anchors on separate masts (headframe crown + a bird-box pole). Nodes re-parent on missing ACKs; jamming is itself reported as evidence.

## Alternatives considered

Single anchor + store-and-forward only; frequency hopping only.

## Consequences

+ 99.8 % delivery under single-anchor jamming. − ≈ R9k extra per site.
