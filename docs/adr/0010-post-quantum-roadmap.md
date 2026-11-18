# ADR-0010: Post-quantum cryptography roadmap

**Status:** Accepted · **Date:** 2026-11-18

## Context

The original ShaftWatch concept proposed ML-KEM (Kyber). Harvest-now-decrypt-later matters for sensitive reports with a long shelf life.

## Decision

Field link: AES-128-CCM is symmetric (Grover only halves its effective strength); offer an AES-256 option in SilkNet v2. Cloud and console: adopt **hybrid X25519 + ML-KEM-768** TLS (FIPS 203) when supported end to end, and ML-DSA (FIPS 204) for evidence signatures alongside Ed25519 during transition.

## Alternatives considered

Deploy liboqs immediately everywhere (immature on MCUs; interoperability risk).

## Consequences

+ Crypto-agility without blocking delivery. − Re-signing archived evidence with ML-DSA will be needed later.
