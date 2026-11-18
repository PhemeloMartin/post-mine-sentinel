# 7. Legal and regulatory compliance (South Africa)

> **Status:** prototype compliance analysis prepared for discussion with the DMPR. It is **not legal advice**. A formal legal opinion, an Information Regulator prior-authorisation assessment (if applicable) and ICASA type approval are required before deployment.

## 7.1 Constitutional baseline

* **Section 14 (privacy):** the system monitors *land and ground vibration*, not people. No images, voices or identities are captured, and coordinates are generalised for low-clearance users.
* **Section 24 (environment):** prioritising and sealing hazardous shafts protects communities' right to an environment that is not harmful to health.
* **Section 33 (just administrative action):** the RAI is explainable (factor contributions are shown), and a human always decides on enforcement action.

## 7.2 Mining law

| Instrument | Relevance | How the design responds |
|---|---|---|
| **MPRDA, Act 28 of 2002**: s5A (no mining without a right), s43 (closure), s46 (state responsibility for derelict and ownerless mines) | Defines the offence and the State's custodial duty for D&O mines | Produces evidence of unlawful activity and a defensible rehabilitation priority list |
| **Draft Mineral Resources Development Bill, 2025** (GG 52704) | Proposed overhaul, including an artisanal and small-scale licensing regime | Clear separation in reporting: *licensed* artisanal activity must not be flagged as illegal. A permit layer is on the roadmap |
| **Draft General (Mining) Laws Amendment Bill, 2026** (published 7 Aug 2026) | Proposes s5B (assisting illegal mining), penalties up to R100 m / 30 years, and amendments to the CPA, Diamonds Act and Precious Metals Act | Evidence model (signed alerts, custody chains) is ready. **The platform relies on enacted law only** and tracks the bill's status |
| **Mine Health and Safety Act, 29 of 1996** | Safety of persons at mines | Safe-egress protocol: alerts route to Mine Rescue Services; no underground pursuit (CRD Mine 2026 lesson) |
| **Precious Metals Act 37 of 2005; Diamonds Act 56 of 1986** | Offences in the illicit trade chain | Out of direct scope; case bundles can support investigations |

## 7.3 Privacy and data protection: POPIA (Act 4 of 2013)

| Condition / section | Design response |
|---|---|
| Accountability (s8) | Named information officer; audit log; this document |
| Processing limitation and minimality (s9–s12) | Nodes transmit **features and class labels only**. Raw vibration windows never leave the device; no audio content is recorded |
| Purpose specification (s13–s14) | Purpose: protect life and enforce mining law at registered sites. Retention schedule enforced by TimescaleDB policies |
| Further processing (s15) | No re-use for unrelated surveillance; contractual and technical (RBAC) controls |
| Information quality (s16) | Validated register (AGSA duplicate-coordinate finding addressed) |
| Openness (s17–s18) | Public notice and community engagement before deployment (Phase 1) |
| Security safeguards (s19–s22) | [06-information-security.md](06-information-security.md); breach notification runbook in the incident response plan (s22) |
| Data subject participation (s23–s25) | PAIA manual; request handling via the operator |
| Special personal information: criminal behaviour (s26, s33) | The system does not identify people. Any personal information about alleged offences is processed only by or for bodies charged by law with applying criminal law (s33), e.g. SAPS via the case service |
| Trans-border flows (s72) | Hosting in Azure **South Africa North**, geo-backup to **South Africa West**: data stays in-country |

## 7.4 Communications, cyber and evidence law

| Instrument | Design response |
|---|---|
| **Electronic Communications Act 36 of 2005** and **ICASA Radio Frequency Spectrum Regulations** (licence-exempt SRD bands) | 868 MHz plan with a firmware-enforced ≤ 1 % duty cycle and listen-before-talk. **Action:** confirm the current National Radio Frequency Plan entry and conditions for the chosen channels and obtain **type approval** for the node and anchor before deployment |
| **RICA, Act 70 of 2002** (interception) | No interception of communications. The acoustic channel (future) computes non-speech features on-device; no speech is stored or transmitted |
| **Cybercrimes Act 19 of 2020** | Hardened devices and signed firmware; logs and evidence preserved for forensic use; incidents reported as required |
| **ECTA, Act 25 of 2002**, s15 (admissibility and weight of data messages) | Integrity demonstrable through Ed25519 signatures and hash-chained audit and custody records |
| **Criminal Procedure Act 51 of 1977**, s212 (affidavit evidence of technical facts) | The case service exports an evidence bundle with digests, custody chain and manifest hash |
| **Critical Infrastructure Protection Act 8 of 2019** | If declared critical infrastructure, the platform's controls already map to ISO 27001 / NIST CSF |

## 7.5 Commercial operation

* **PSIRA (Private Security Industry Regulation Act 56 of 2001):** selling monitoring services to private mine owners may constitute a "security service". **The operating entity must register with PSIRA** before offering such services. Government-to-government deployments should be confirmed with counsel.
* **PAIA (Act 2 of 2000):** the D&O register and SAMINDABA data should be requested formally. See [policies/paia-request-template.md](policies/paia-request-template.md). A PAIA manual is required for the operator.
* **SACAA Part 101** (drones): only for the future verification-flight phase, by licensed RPAS operators.
* **Public procurement:** the PFMA / MFMA and Treasury regulations apply to any state contract.

## 7.6 Ethical commitments (beyond compliance)

See the [ethics charter](policies/ethics-charter.md): safety first, not manhunts; land, not people; a human in the loop; need-to-know; honest models.
