# 3. Software requirements specification

Structured after Sommerville, *Software Engineering* (10th ed.), ch. 4: user requirements, then system requirements (functional and non-functional), with traceability to tests.

## 3.1 User roles

| Role | Organisation (example) | Goal |
|---|---|---|
| SOC analyst | DMPR / Council for Geoscience | See national risk; triage live alerts; plan inspections |
| Field officer | SAPS Vala Umgodi, mine inspectorate | Receive dispatches; record evidence safely |
| Auditor | AGSA, Information Regulator, oversight | Verify that the system and its operators behave lawfully |
| Community liaison | Municipality | Share safety information without exposing active sites |
| Administrator | Operating entity | Manage users, nodes and keys |

## 3.2 User stories (excerpt)

* **US-01** As an analyst, I want every derelict mine ranked by risk *with reasons* so I can defend inspection priorities to the Auditor-General.
* **US-02** As an analyst, I want an alert within minutes when people enter a monitored shaft at night so a response can be organised before anyone goes underground.
* **US-03** As a field officer, I want the alert to tell me *where* the activity is (a fix with uncertainty) and whether a sensor was tampered with, so I approach safely.
* **US-04** As an auditor, I want to prove that no one altered alerts, evidence or logs after the fact.
* **US-05** As a community liaison, I want to warn residents about dangerous areas without revealing exact active-site coordinates.
* **US-06** As an administrator, I want a site to keep working if one gateway is jammed or a sensor is stolen.

## 3.3 Functional requirements

| ID | Requirement | Implemented in | Verified by |
|---|---|---|---|
| FR-01 | Maintain a validated national register of mines (dates, status, production, residual estimate) | `data/scripts/build_mines.py` | CI `contracts` job (fails on misplaced or duplicate coordinates) |
| FR-02 | Compute an explainable Residual Attraction Index per mine | `ml/sentinel_ml/risk/rai.py` | `ml/tests/test_satellite_netsim_risk.py` |
| FR-03 | Classify 4 s geophone windows on-device into 7 classes | `firmware/.../features.cpp`, `classifier.cpp` | Firmware golden-vector parity tests |
| FR-04 | Transmit authenticated, encrypted, replay-protected frames over a multi-hop mesh | `firmware/.../silknet`, `services/ingest` | RFC 3610 + SilkNet vectors (C++, Go, Python) |
| FR-05 | Fuse evidence per site into a posterior intrusion probability | `services/api/app/services/fusion.py`, `apps/.../sim/engine.ts` | `test_threat_windows_raise_signed_alert_after_persistence`, scenario tests |
| FR-06 | Raise, acknowledge, dispatch and resolve alerts; sign each alert | `services/api` | API tests (lifecycle, 409 on illegal transitions, signature verification) |
| FR-07 | Locate seismic sources by TDOA with an uncertainty ellipse | `ml/.../fusion/tdoa.py`, `sim/tdoa.ts` | `test_tdoa_recovers_source_with_noise`, `math.test.ts` |
| FR-08 | Open a case per dispatched alert; track evidence with chain of custody; export a court bundle | `services/case-service` | xUnit `Full_workflow_produces_a_verifiable_evidence_bundle` |
| FR-09 | Plan inspection routes under a time budget | `ml/.../planning`, `/api/v1/planning/route`, `lib/planning.ts` | `test_planning.py`, API planning tests |
| FR-10 | Detect surface change at shafts from Sentinel-2 | `ml/.../satellite` | `test_cusum_detects_injected_disturbance…` |
| FR-11 | Visualise national risk in 3D with a historical timeline | `apps/command-center` (Orbital) | Browser smoke test |
| FR-12 | Simulate a site digital twin with selectable scenarios | `apps/command-center/src/sim` | 7 scenario acceptance tests |
| FR-13 | Enforce RBAC; generalise locations for low-clearance roles | `app/core/rbac.py`, `deps.py`, ASP.NET policies | `test_liaison_gets_generalised_locations…`, `Reading_cases_requires…` |
| FR-14 | Keep a tamper-evident audit trail of logins, views of precise locations and state changes | `app/core/audit.py`, PG trigger | `test_audit_chain_verifies_and_detects_tampering`, CI `api-postgres` |

## 3.4 Non-functional requirements

| ID | Category | Requirement | Evidence |
|---|---|---|---|
| NFR-01 | Performance | Alert within **120 s** of entry into the sensor footprint (p95) | Scenario benchmark: median 44–47 s, p90 ≤ 64 s (160 runs) |
| NFR-02 | Accuracy | Benign false-alarm rate per site-night **< 2 %** for wind, jackals and cattle | 0 false alarms in 80 calibrated benign runs |
| NFR-03 | Reliability | Packet delivery ≥ 99 %; survive the loss of one anchor | netsim E1/E3 |
| NFR-04 | Energy | ≥ 12 months per node on a 6 Ah cell | netsim battery model ≈ 470–520 days |
| NFR-05 | Edge footprint | Model ≤ 8 KB flash; ≤ 2 k MAC per inference | 5.6 KB, 1,296 MAC |
| NFR-06 | Security | Confidentiality and integrity of all field frames; no plaintext keys in repo or images | AES-128-CCM, Key Vault CSI, gitleaks in CI |
| NFR-07 | Privacy | No personal data or audio content leaves nodes; coordinates generalised for low clearance | Design (features only), RBAC tests |
| NFR-08 | Availability | Core API 99.9 % monthly (SLO); zero-downtime deploys | HPA, PDB, rolling updates, readiness probes |
| NFR-09 | Usability | Primary tasks (find a site, triage an alert) in ≤ 3 interactions; WCAG 2.2 AA intent | [08-hci-and-ux.md](08-hci-and-ux.md) |
| NFR-10 | Maintainability | Every component linted, typed and tested in CI; ADRs for significant decisions | `.github/workflows/ci.yml`, `docs/adr` |
| NFR-11 | Portability | Runs offline as a demo (browser only), on Docker Compose, and on Kubernetes | Demo mode, `infra/` |
| NFR-12 | Compliance | Data hosted in South Africa; retention per schedule | Terraform `southafricanorth`, Timescale retention policy |

## 3.5 Key use case: UC-02 "Respond to a night-time intrusion"

| | |
|---|---|
| **Primary actor** | SOC analyst |
| **Preconditions** | Site monitored; nodes provisioned; analyst signed in |
| **Main flow** | 1. Nodes detect footsteps and send DETECTION frames. 2. Ingest authenticates and batches per window. 3. Fusion raises the posterior; after two consecutive windows ≥ 0.9 an alert is raised and signed. 4. The analyst sees the alert, fix and evidence and **acknowledges**. 5. The analyst **dispatches**; the outbox opens a case in the case service. 6. A field officer is assigned and goes on scene; the safe-egress protocol applies. 7. Evidence is added and handed over with custody links. 8. The case is referred or closed; the alert is resolved when the posterior decays. |
| **Alternatives** | 2a. Frame fails authentication → dropped, counted, security alert on rate. 3a. Only one anomalous window → no alert (persistence gate). 5a. Case service down → outbox retries with back-off; dead-letter after 8 attempts; operator alerted. |
| **Postconditions** | Audit log contains login, view, acknowledge and dispatch entries; the alert signature verifies; the evidence bundle verifies. |
