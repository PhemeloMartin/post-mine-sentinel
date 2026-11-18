# 16. Business case, roadmap and pitch

## 16.1 Value proposition

> **Post-Mine Sentinel turns South Africa's 6,100 unwatched holes into a risk-ranked, sensor-guarded network that warns before people die, at a cost per site comparable to a few days of a single rescue operation.**

| Customer | Pain | What they get |
|---|---|---|
| **DMPR + Council for Geoscience** (anchor customer) | Statutory duty for D&O mines; an unmaintained register; ~2 rehabilitations a year | Cleaned register; RAI-ranked rehabilitation list; national monitoring and evidence |
| **SAPS / SANDF** | Dangerous, reactive operations (Stilfontein 2024–25, CRD Mine 2026) | Early, located, signed alerts; safe-egress protocol; court-ready bundles |
| **Mining companies** | Closed shafts infiltrated; closure liabilities | Per-site monitoring subscriptions; ESG and closure evidence |
| **Municipalities** | Shafts next to homes and schools | Generalised public-safety map; alerts for priority sites |
| **Insurers / developers** | Unknown ground risk | Due-diligence reports (ShaftWatch + register) |

## 16.2 Revenue model (assumptions to validate in the pilot)

* **Government national licence:** register maintenance, national risk analytics and the satellite layer for all D&O sites, plus SOC tooling.
* **Per-site monitoring:** hardware at cost plus ≈ R500–1,500 per site per month (sensors, connectivity, SOC, maintenance).
* **Reports:** one-off land due-diligence reports.

## 16.3 Unit economics (indicative)

| Item | Prototype | Production (1,000+ nodes) |
|---|---|---|
| Spider node | ≈ R3,180 | ≈ R1,200 |
| Anchor gateway | ≈ R9,000 | ≈ R7,000–9,000 |
| **Site (24 + 2)** | **≈ R90k** | **≈ R47k** |
| Connectivity (LTE, per site per month) | ≈ R150–300 | ≈ R150–300 |
| Cloud (national, per month) | n/a | ≈ R40–80k (AKS + Postgres HA + Key Vault + logs) |

The marginal cost of the *satellite* layer per extra site is close to zero, so every registered site can be risk-ranked; ground sensors go only where the RAI justifies them.

## 16.4 Roadmap

| Phase | Duration | Scope | Exit criteria |
|---|---|---|---|
| **0: Prototype** (this repository) | done | Full software stack, simulation, firmware cores, docs | All tests green in CI |
| **1: Field pilot** | 6 months | Buffelsfontein / Stilfontein (3 sites, ~54 nodes) with SAPS and Mine Rescue; ICASA type approval; PSIRA registration; POPIA assessment | Measured detection and false-alarm rates on real data; ≥ 99 % uptime; community engagement completed |
| **2: KOSH + West Rand** | 12 months | 16 pilot sites (220 nodes), Phase-1 data used to retrain models; STM32WL production node | Cost per site ≤ R50k; SUS ≥ 75; case-to-referral workflow used by SAPS |
| **3: National** | 24–36 months | RAI-prioritised expansion; ShaftWatch across all 6,100 sites; integration with CGS and DMPR systems | Measurable fall in incidents at monitored sites; rehabilitation re-prioritised by RAI |
| **4: Region** | later | Zimbabwe, Ghana, the Namibian border fields | Partnerships |

## 16.5 KPIs

Incidents detected before underground entry · mean time from alert to dispatch · false alarms per 100 site-nights · node uptime · sites sealed per year on RAI priority · cost per protected site.

## 16.6 Risks

| Risk | Mitigation |
|---|---|
| Field performance below simulation (domain shift) | Commissioning period; Phase-1 data; publish honest metrics |
| Theft and vandalism of nodes | Concealment; tamper alerts make theft itself evidence; low unit cost |
| Spectrum or regulatory delays | Early ICASA engagement; SF and power within licence-exempt limits |
| Misuse of data (syndicates, overreach) | RBAC, generalisation, audit, ethics charter, legal review |
| Institutional follow-up fails (cf. India MSS: 51 % of alerts acted on) | Audited lifecycle with accountability KPIs; case service integrated with SAPS |

## 16.7 Ten-slide pitch outline for the DMPR

1. **The hole problem:** 6,100 D&O mines, 2 rehabilitations a year, Stilfontein, CRD Mine.
2. **Why now:** the 2025 and 2026 bills raise penalties, but enforcement needs evidence and early warning.
3. **What others did:** Amazon Mining Watch, India MSS (and its follow-up gap), Sabi Sand LoRa, RFCx.
4. **Our answer:** satellite risk triage + concealed spider sensors + our own mesh + a court-ready workflow.
5. **Live demo:** Orbital view (timeline 1852 → 2026), then the Buffelsfontein site twin: *Night incursion*.
6. **Proof:** 160/160 simulated intrusions detected, 0/80 false-alarm runs (calibrated), 99.8 % delivery under jamming, median detection < 50 s.
7. **Safety and law:** safety first, not manhunts; POPIA, ECTA s15, CPA s212, RICA, ICASA.
8. **Cost:** ≈ R47k per site in production vs the cost of one rescue operation.
9. **Pilot ask:** 3 sites at Stilfontein, 6 months, with SAPS and Mine Rescue Services.
10. **Team and roadmap.**
