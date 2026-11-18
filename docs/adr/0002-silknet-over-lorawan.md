# ADR-0002: Private SilkNet mesh on LoRa instead of LoRaWAN

**Status:** Accepted · **Date:** 2026-11-18

## Context

Nodes sit < 1 m above ground behind fences and rocks, with ranges of ~90 m node-to-node. Sites may lose back-haul. LoRaWAN is a single-hop star that depends on a network server.

## Decision

Build SilkNet: LoRa PHY, ETX collection tree, hop-by-hop ACKs, AES-128-CCM per-node keys, 32-byte frames, MQTT from anchors to the cloud.

## Alternatives considered

LoRaWAN (Class A) via a public network; Meshtastic; Zigbee/802.15.4 (too short-range); cellular per node (cost, power, coverage).

## Consequences

+ Multi-hop, works offline, private, small frames. − Custom protocol to maintain and certify (mitigated by a formal spec, vectors and tests in three languages).
