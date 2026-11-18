# ADR-0006: ESP32-S3 for the prototype, STM32WLE5 for production nodes

**Status:** Accepted · **Date:** 2026-11-18

## Context

We need a fast, cheap, available prototype board (Heltec V3 is sold locally), but a 1-year battery life requires sub-mA average current.

## Decision

Prototype on ESP32-S3 + SX1262 with the Arduino/FreeRTOS stack. Keep DSP, ML and SilkNet in portable C++ libraries so the production STM32WLE5 port only replaces the HAL.

## Alternatives considered

nRF52840 + SX1262; STM32WL from day one (slower to prototype).

## Consequences

+ Fast iteration now, low power later, no rewrite. − Two hardware targets to test.
