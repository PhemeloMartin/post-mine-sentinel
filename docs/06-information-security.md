# 6. Information security

Framed with Whitman & Mattord, *Principles of Information Security*: the **CNSS security model** (confidentiality, integrity, availability × storage, processing, transmission × policy, education, technology) and a **security SDLC** (investigation → analysis → design → implementation → maintenance). Controls are mapped to **ISO/IEC 27001:2022 Annex A** and **NIST CSF 2.0**.

## 6.1 Why this system is a high-value target

A map of *active* illegal mining sites, the locations of concealed sensors and the identities of responders are valuable to **organised syndicates**. A leak could get people killed, either responders walking into an ambush or miners moved to more dangerous workings. Integrity matters as much as confidentiality: evidence must stand up in court.

## 6.2 Information assets and classification

| Asset | Classification | C | I | A |
|---|---|---|---|---|
| Precise coordinates of active alerts and sensor positions | **Secret** (need-to-know) | High | High | Medium |
| SilkNet site keys, evidence-signing key | **Secret** (HSM) | Critical | Critical | High |
| Alerts, cases, evidence digests, audit log | Restricted | High | **Critical** | High |
| National register and RAI (aggregated) | Restricted (generalised: internal) | Medium | High | Medium |
| Model weights, firmware | Internal | Low | High | Medium |

## 6.3 Threat model (STRIDE)

| Threat | Example | Mitigations (implemented → where) |
|---|---|---|
| **S**poofing | Fake node injects frames; stolen console password | AES-128-CCM MIC per node key, fail-closed decode (`ccm.go`, `crypto.cpp`); auth-failure rate alert; Argon2id passwords, lockout, rate limiting, generic error messages (`routes.py`); MFA-ready |
| **T**ampering | Node pulled off the fence; DB row edited by an insider; evidence swapped | Accelerometer tamper + signed last-gasp frame; append-only audit hash chain + PG trigger; per-item custody hash chain including the evidence digest; Ed25519 alert signatures |
| **R**epudiation | "I never dispatched that team" | Every state change audited with actor and role; hash-chained; WORM export |
| **I**nformation disclosure | Leak of active-site map; RF sniffing | RBAC + **location generalisation** (~5 km grid) for low clearance; precise-location *views* are audited; payload encryption; no PII collected; TLS everywhere; private DB endpoint |
| **D**enial of service | 868 MHz jamming; API flood; case service down | Dual anchors + ETX re-routing (E3: 99.8 % vs 49 %); jamming detection as evidence; ingress rate limits; HPA; circuit breaker + outbox + DLQ |
| **E**levation of privilege | Liaison calls analyst endpoints; container escape | Server-side permission guards on every route (audited denies); non-root, read-only, capability-dropped containers; Pod Security "restricted"; default-deny NetworkPolicies |

### Attack tree: "syndicate locates sensors to avoid them"
1. Physically search the site → **concealment**: nodes look like spiders and webs; a tampered node triggers an alert *and* reveals intent.
2. Radio direction-finding → low duty cycle (≤ 1 %), short frames (≈ 247 ms), sync word not LoRaWAN, no beaconing from leaf nodes.
3. Insider leaks the map → need-to-know RBAC, generalised coordinates, audited precise views, anomaly review of the audit log.
4. Compromise the cloud → workload identity (no static credentials), Key Vault HSM, private networking, signed images, CodeQL/Trivy/gitleaks in CI.

## 6.4 Cryptographic inventory

| Use | Algorithm | Key management |
|---|---|---|
| Field frames | AES-128-CCM, 8-byte MIC, 13-byte nonce (site‖node‖counter) | Per-node keys `HMAC-SHA256(K_site, …)` provisioned to a secure element; site keys in Key Vault (HSM) |
| Replay protection | 32-bit counter, 64-frame sliding window (RFC 4303) | Counters reserved ahead in flash (never reused) |
| Alert / evidence signatures | Ed25519 | Key Vault; public key published for independent verification |
| Audit and custody integrity | SHA-256 hash chains | n/a (verifiable by anyone with read access) |
| Passwords | Argon2id (64 MiB, t = 3) | Rehash on login when parameters change |
| Sessions | HS256 JWT, 15-minute expiry, pinned algorithm, iss/aud validated | Secret in Key Vault; ≥ 256-bit enforced by the .NET service |
| Transport | TLS 1.2+ (ingress, MQTT 8883 mTLS, PostgreSQL) | cert-manager / Let's Encrypt; per-gateway client certificates |

Post-quantum: see [ADR-0010](adr/0010-post-quantum-roadmap.md).

## 6.5 Control mapping (excerpt)

| Control | ISO 27001:2022 | NIST CSF 2.0 | Implementation |
|---|---|---|---|
| Access control and least privilege | A.5.15, A.8.2, A.8.3 | PR.AA | `rbac.py`, ASP.NET policies, AKS Azure RBAC |
| Authentication | A.8.5 | PR.AA-03 | Argon2id, lockout, rate limit, JWT validation |
| Cryptography | A.8.24 | PR.DS-01/02 | §6.4 |
| Logging and monitoring | A.8.15, A.8.16 | DE.CM | Structured JSON logs with request IDs; Prometheus alert rules; audit chain |
| Secure development | A.8.25–A.8.29 | PR.PS-06 | CI: CodeQL, Trivy, gitleaks, dependency review, tests as gates |
| Supplier / supply chain | A.5.19–A.5.22 | GV.SC | Pinned versions, Dependabot, SBOM + provenance, cosign signatures, stdlib-only Go ingest |
| Data protection and privacy | A.5.34 | PR.DS | POPIA design ([07](07-legal-and-regulatory.md)); retention policies |
| Incident management | A.5.24–A.5.28 | RS | [Incident response plan](policies/incident-response-plan.md) |
| Physical security of field devices | A.7.x | PR.AA-06 | Concealment, tamper switch, secure boot + flash encryption, key in secure element |
| Resilience | A.5.29, A.8.14 | RC | Zone-redundant DB, geo-backups, dual anchors, IaC rebuild |

## 6.6 Secure development practices in this repository

* **Fail closed:** frames with bad MICs are never parsed; a node without a key never transmits; the API refuses to boot in prod without secrets; .NET refuses short JWT keys.
* **No secrets in Git:** `.gitignore`, `.env.example` only, Key Vault CSI, and gitleaks in CI. The single key in `infra/ingest/sites.dev.json` is the public FIPS-197 example key and is labelled dev-only.
* **Input validation at every trust boundary:** Pydantic (API), explicit validators (.NET), length and type checks (Go, C++).
* **Errors never leak internals:** RFC 7807 responses carry a `traceId`, and details go to logs ([15-error-handling.md](15-error-handling.md)).

## 6.7 Security testing

Unit tests for crypto conformance (FIPS-197, RFC 3610) in three languages; tamper-detection tests (bit flips, forged keys, rewritten audit and custody rows); auth tests (lockout, enumeration resistance, forged JWT, 429 rate limit); RBAC tests (403 + audited deny); and a CI check that PostgreSQL rejects `UPDATE` on `audit_log`. Planned: OWASP ZAP baseline scan in staging; an RF penetration test (jamming, replay, rogue anchor) during the field pilot.
