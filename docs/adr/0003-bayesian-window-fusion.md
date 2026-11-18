# ADR-0003: Bayesian log-odds fusion with window votes and persistence

**Status:** Accepted · **Date:** 2026-11-18

## Context

Single-sensor alarms are noisy (the UGS literature warns that cadence-only detection has high false-alarm rates). Operators need one calibrated number per site.

## Decision

Per-site log-odds belief with a RAI-based prior, exponential decay (T½ = 120 s), Chair–Varshney votes per 4 s window with a √n correlation discount, a negative-evidence floor, PIR corroboration, and an alert after two consecutive windows ≥ 0.9.

## Alternatives considered

Rule-based k-of-n alarms; a learned sequence model (no labelled field data yet); Dempster–Shafer.

## Consequences

+ Interpretable, tunable, measurable (0/80 false-alarm runs, 160/160 detections over 480 simulated runs). − Independence assumptions are approximations; parameters need field calibration.
