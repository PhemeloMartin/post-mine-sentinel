# 1. Problem statement

> South Africa knows where most of its abandoned mine shafts are. What it does not know is **which ones are active, changing or dangerous right now**, and it has no affordable way to find out before people die.

## 1.1 The scale of the legacy

| Indicator | Value | Source |
|---|---|---|
| Derelict and ownerless (D&O) mines on the state register | **≈ 6,100** | Auditor-General of South Africa (AGSA), 2022 follow-up audit, as reported by Daily Maverick and Fin24 |
| …of which "other high-risk" (gold, coal, copper, etc.) | **2,322**, none rehabilitated | AGSA 2022 |
| Asbestos D&O mines | 261 (229 outstanding) | AGSA 2022 |
| Average rehabilitation rate | **2.25 mines per year** (2021), up from 1.67 in 2009 | AGSA 2022 |
| Time to clear the asbestos backlog alone at that rate | **≈ 69 years** | AGSA 2022 |
| Estimated cost of the asbestos backlog alone | ≈ R3.8 billion | AGSA 2022 |
| Monitoring of D&O mines 2009–2015 | **None**. 2015–2020: asbestos sites only | AGSA (per the original ShaftWatch ZA brief) |
| Register quality | Several mines recorded with **identical GPS coordinates**; completeness not independently verified | AGSA |

The AGSA also found that **no procedures existed to maintain the D&O database** and that the responsibility had not been allocated since 1 April 2020. Later reporting (2026) cites 2,568 high-risk mines and 1,170 dangerous openings. The exact count depends on the source, which is itself a symptom of the data problem.

## 1.2 The human cost

* **Stilfontein (Buffelsfontein Gold Mine, North West), 2024–2025.** After a months-long standoff at Shaft 11, the January 2025 rescue recovered **78 bodies and 246 survivors**, and 87 deaths were recorded in total. Of the survivors identified by SAPS, 128 were Mozambican, 80 from Lesotho, 33 Zimbabwean and 5 South African. Nearly 2,000 illegal miners had been arrested in the related operation since August 2024. *(Daily Maverick, 16 Jan 2025; Northern Miner; AP/PBS.)*
* **Disused CRD Mine, Florida (Johannesburg), 17 July 2026.** Two SANDF paratroopers (1 Parachute Battalion) on Operation Prosper died after falling into an open vertical shaft while pursuing suspected illegal miners. *(TimesLIVE, EWN, Mining Weekly, Parliament, July 2026.)*
* Many illegal miners are trafficked, coerced or economically desperate. Every death above happened at a site the state already knew about.

## 1.3 The economic and security cost

* Illegal mining and the associated illicit precious-metals trade are estimated to cost the economy **≈ R60 billion a year** (Minerals Council South Africa / PwC estimates, repeated by the Minister in 2024–2026), with ≈ **R23.5 billion** in lost tax revenue (Frans Cronje Private Clients). These are estimates. Illegal production is inherently hard to measure.
* Analysts estimate that **5–30 %** of gold output is mined or traded illegally, involving ≈ 30,000 illegal miners.
* Syndicates infiltrate not only derelict shafts but also operating mines and recently closed operations (operator statements, 2023–2026). A rising gold price (2025–2026) increases the incentive.
* The state's response is escalating: Operation Vala Umgodi (SAPS), SANDF deployment under Operation Prosper, the **draft Mineral Resources Development Bill (2025)** and the **draft General (Mining) Laws Amendment Bill (2026)**. The latter proposes penalties of up to R100 million or 30 years' imprisonment and a new offence of assisting illegal mining. Tougher laws still need **evidence and early warning** to be enforceable.

## 1.4 Why current approaches are not enough

| Approach | Limitation |
|---|---|
| Physical patrols / army deployment | Cannot cover ~6,000 sites; dangerous (CRD Mine 2026); reactive |
| Sealing shafts | ≈ 2 rehabilitations per year; seals are reopened by syndicates |
| Satellite imagery alone (e.g. Amazon Mining Watch) | Sees **surface** change only, typically monthly; underground work and night-time access are invisible |
| Commercial high-resolution intelligence | Expensive and built for a few high-value sites, not thousands of derelict ones |
| Visible cameras and fences | Easily spotted, vandalised and stolen; reveal that a site is being watched |
| The D&O register | Unmaintained, with duplicate and incorrect coordinates; no risk ranking |

## 1.5 Problem definition

> **How might the State, municipalities and mine operators detect illegal entry into derelict mine workings early enough to prevent deaths, at a cost that scales to thousands of sites, while producing court-admissible evidence and protecting the privacy and safety of vulnerable people?**

### Research questions

1. **RQ1. Prioritisation:** Which derelict sites are most likely to attract illegal mining, and why? *(Residual Attraction Index, ShaftWatch satellite change detection.)*
2. **RQ2. Detection:** Can low-cost, concealed ground sensors detect and classify human activity (footsteps, digging, drilling, blasting) at a shaft with a false-alarm rate low enough to be operationally trusted? *(S.P.I.D.E.R. edge ML + Bayesian fusion.)*
3. **RQ3. Communication:** Can a self-healing radio mesh deliver alerts reliably from sites without power or fibre, under regulatory duty-cycle limits and deliberate jamming? *(SilkNet.)*
4. **RQ4. Response:** How can an alert become a safe, accountable response with an intact evidence chain? *(Alert lifecycle, case and evidence service, audit chain.)*

## 1.6 Objectives (SMART)

| # | Objective | Measure | Prototype result |
|---|---|---|---|
| O1 | Rank all registered sites by illegal-mining risk with an explainable model | AUC against reported incidents | Expert model AUC **0.80**; learned LOO AUC 0.76 (`ml/artifacts/risk_calibration.json`) |
| O2 | Detect threat activity at a monitored shaft within 2 minutes of entry into the sensor footprint | Detection latency (simulation, 40 seeds × 4 threat scenarios) | **160/160 detected**; median ≈ 44–47 s, p90 ≤ 64 s |
| O3 | Keep false alarms rare | False-alarm runs on benign scenarios (wind, jackals, cattle) | **0 / 80** calibrated runs (40 quiet nights + 40 grazing days at a high-risk site) |
| O4 | Deliver ≥ 99 % of packets and survive the loss or jamming of one gateway | Discrete-event simulation | **99.3–99.9 %** PDR; **99.8 %** with one of two anchors jammed vs 49 % single-anchor |
| O5 | ≥ 1 year of battery life per node | Energy model | **≈ 470–520 days** (6 Ah Li-ion, before solar harvesting) |
| O6 | Every alert signed, every action audited, every evidence hand-over chained | Integrity tests | Ed25519 signatures, SHA-256 audit and custody chains verified in tests |

## 1.7 Scope

**In scope (prototype):** risk register and national 3D map; site digital twin and simulation; edge ML pipeline; SilkNet protocol; firmware; ingest, fusion and alerting; case and evidence management; security, legal and HCI design; DevOps.
**Out of scope (future phases):** field-validated hardware certification (ICASA type approval), real labelled field data, drone verification flights (SACAA Part 101), integration with SAPS case systems, national rollout.

## 1.8 Stakeholders

DMPR (Department of Mineral and Petroleum Resources; legal custodian of D&O mines) · Council for Geoscience (maintains the D&O database) · SAPS (Vala Umgodi) and SANDF (Operation Prosper) · Mine Rescue Services · municipalities (e.g. City of Johannesburg, Matlosana) · mining companies with closed shafts · affected communities · the Auditor-General · the Information Regulator.

---
*Sources are listed in [02-research-and-precedents.md §2.6](02-research-and-precedents.md#26-sources).*
