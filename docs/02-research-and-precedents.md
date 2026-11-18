# 2. Research and international precedents

Post-Mine Sentinel deliberately **builds on what has already worked elsewhere** rather than inventing from scratch. It then adapts those approaches to South Africa's specific problem: illegal activity at **old, known shafts** in grassland, peri-urban and urban settings, much of it **underground and at night**.

## 2.1 Remote sensing: watching land from space

| Programme | What it does | Lesson for SA |
|---|---|---|
| **Amazon Mining Watch** (Amazon Conservation, Earth Genome, Pulitzer Center) | ML on free Sentinel-2 imagery (10 m) to map gold-mining scars across the Amazon, updated quarterly | Free data plus ML scales to a continent. **Adopted** as the ShaftWatch layer |
| **MAAP**, Peru (Monitoring of the Andean Amazon Project) | Near-real-time satellite alerts that supported enforcement such as *Operación Mercurio* (2019) in La Pampa | Alerts only matter when tied to an enforcement workflow → our alert → case pipeline |
| **India Mining Surveillance System** (Indian Bureau of Mines, BISAG, MeitY; 2016) | Overlays lease boundaries on satellite scenes and flags activity within 500 m of leases; triggers go to district officers via a mobile app | 296 triggers in phase 1. A later RTI-based review found only **51 % of alerts were acted on and 14 % confirmed illegal mining**. **Lesson: detection without accountable follow-up fails.** Hence our audited alert lifecycle and evidence chain |
| **Ghana** (CERSGIS satellite service; Minerals Commission AI drone monitoring, 2025; GH¢150 m to NAIMOS in the 2026 budget) | Layered satellites, drones and community verification against *galamsey* | Layering sensors works, but national integration is hard → one fused belief per site |
| **Colombia** (UNODC SIMCI EVOA reports) | Annual satellite census of alluvial gold exploitation | A census builds the baseline register. Ours is `data/mines` |

**Gap:** all of these see **surface change**, typically monthly. A derelict Witwatersrand shaft can be worked for months underground with almost no surface signature, and access happens at night.

## 2.2 Ground sensing: hearing activity hidden in plain sight

| Precedent | What it does | Lesson |
|---|---|---|
| **Rainforest Connection Guardian** | Solar-powered acoustic devices (originally recycled phones) mounted high in the canopy detect chainsaws, vehicles and gunshots with ML and send alerts over GSM or satellite. Reported at ~750,000 ha | Concealed edge-ML sensors work in the field. **Caveats:** GSM coverage limits deployment; an over-sensitive West Sumatra pilot needed a false-positive review process. → We use our own radio mesh and calibrate false-alarm rates explicitly |
| **Connected Conservation, Sabi Sand** (Dimension Data / NTT and Cisco, from 2015) | LoRaWAN networks, IoT sensors, thermal cameras and fence alarms around a 62,000 ha reserve bordering Kruger. Reported ~96 % fewer incursions (self-reported, varying baselines) | **The closest South African precedent:** LoRa sensor networks work in SA conditions and change behaviour |
| **Unattended ground sensors (UGS)** | Military geophone fields for perimeter and border security, often disguised as rocks | **Cadence-only footstep detection causes many false alarms** (Johns Hopkins IGARSS 2012; Army Aberdeen data). Feature-rich classifiers (spectral, wavelet, kurtosis) and seismic + PIR fusion reduce them (Penn State / Army Research Lab). → 21 features, a multi-class MLP and seismic + PIR Bayesian fusion |
| **Mine microseismic networks** | Deep-level SA gold mines already run seismic networks to monitor rock bursts and blasting | Seismic sensing of mining is mature. An **unscheduled blast at a closed mine is unambiguous evidence** → the blast class |

## 2.3 Legacy-mine governance elsewhere

* **United States: Abandoned Mine Land program (SMCRA 1977)** and MSHA's *Stay Out–Stay Alive* campaign. Shafts are often closed with **bat-compatible gates** that keep people out while preserving habitat. → Our sealing recommendations prioritise by RAI, and our sensors are designed to live *on* the gate and headframe.
* **United Kingdom: The Coal Authority** maintains a national register of mine entries with a 24-hour hazard reporting line. → A maintained register plus a hotline. The data pipeline in `data/scripts` validates and cleans ours.
* **Germany: Wismut GmbH** (uranium legacy, a multi-billion-euro remediation programme since 1991). → Long-term, state-funded, data-driven programmes are possible; prioritisation is key.
* **Australia: state legacy and abandoned mines programmes** (e.g. NSW Legacy Mines Program). → Risk-ranked registers drive remediation budgets, which is exactly what the RAI does.

## 2.4 Synthesis: what we reuse and what is new

| Capability | Borrowed from | New in Post-Mine Sentinel |
|---|---|---|
| Free satellite change detection | Amazon Mining Watch, MAAP | Per-shaft **seasonal self-baseline + CUSUM**, so dry Karoo and grassy Highveld sites are judged fairly |
| Concealed edge-ML sensors | RFCx, UGS | **Biomimetic "spider" nodes** (the web is the antenna; the legs are geophone spikes); seismic classification of *digging, drilling and blasting*, not just footsteps |
| LoRa networks in SA reserves | Connected Conservation | **SilkNet**: a private, authenticated (AES-CCM), replay-protected, self-healing mesh with **dual anchors** that survives jamming |
| Risk-ranked remediation | US AML, Australian programmes | **Residual Attraction Index**: interpretable, explainable, calibrated against incidents |
| Alert follow-up | Lesson from India's MSS (51 % acted on) | **Audited alert lifecycle → case → court-ready evidence bundle** with chain of custody |
| Ethics | RFCx and conservation tech practice | **Safety first, not manhunts**; location generalisation for low-clearance roles; no audio content or identities |

## 2.5 Building on the original ShaftWatch ZA concept

This repository grew from the *ShaftWatch ZA* hackathon brief (satellite early warning, risk scoring, QAOA inspection planning, post-quantum encryption). It keeps all four ideas and extends them:

* ShaftWatch → the **satellite layer** (`ml/sentinel_ml/satellite`, Earth Engine pipeline).
* Risk scoring → the **Residual Attraction Index**, plus a Bayesian per-site **posterior** that fuses ground evidence.
* QAOA → an **exact statevector QAOA** next to exact DP, simulated annealing and ILS heuristics (`ml/sentinel_ml/planning`). It is honestly benchmarked: classical solvers win at today's sizes, and the QUBO is quantum-ready.
* Post-quantum encryption → recorded as **ADR-0010** (hybrid ML-KEM for the console and back-haul once FIPS 203 libraries are mature on all platforms). Field frames use AES-128-CCM, which is not broken by Shor's algorithm. Grover only halves its effective strength, which is why a 256-bit key option is on the roadmap.

## 2.6 Sources

* Daily Maverick, "Stilfontein mine rescue ends with 78 dead, 246 rescued…", 16 Jan 2025. https://www.dailymaverick.co.za/article/2025-01-16-stilfontein-mine-rescue-ends-with-78-dead-246-rescued-and-ringleaders-in-custody/
* Northern Miner, "South Africa mine rescue ends with 246 saved, 78 dead…". https://northernminer.com/news/south-africa-mine-rescue-ends-with-246-saved-78-dead-as-illegal-mining-crisis-mounts/1003874872
* PBS NewsHour / AP, "Standoff in South Africa ends with 87 miners dead…". https://www.pbs.org/newshour/amp/world/standoff-in-south-africa-ends-with-87-miners-dead-and-anger-over-police-tactics
* Sowetan, "Stilfontein in numbers…", 16 Jan 2025. https://www.sowetan.co.za/news/2025-01-16-stilfontein-in-numbers-only-26-of-the-almost-2000-zama-zamas-are-south-african/
* Daily Maverick, "6,000 health and environmental 'time bombs'…", 8 Jun 2022. https://www.dailymaverick.co.za/article/2022-06-08-6000-health-and-environmental-time-bombs-still-to-be-defused-govt-decades-behind-schedule
* Fin24, "Govt too slow in rehabilitating thousands of abandoned mines, says AG", 14 Sep 2022. https://www.w24.co.za/fin24/companies/govt-too-slow-in-rehabilitating-thousands-of-abandoned-mines-says-ag-20220914
* IOL, "Ghost mines, deceased children and a R14 billion problem", 31 May 2026. https://iol.co.za/business/2026-05-31-investigation--ghost-mines-deceased-children-and-a-r14-billion-problem/
* Daily Investor, "The government helps criminal syndicates steal R23.5 billion a year…". https://dailyinvestor.com/mining/144227/the-government-helps-criminal-syndicates-steal-r23-5-billion-a-year-from-south-africa/
* Engineering News, "South Africa's mining sector faces an existential threat from crime", 6 Aug 2026. https://www.engineeringnews.co.za/article/south-africas-mining-sector-faces-an-existential-threat-from-crime-2026-08-06
* Polity, "Illegal mining impact on infrastructure and the economy", 14 Aug 2026. https://polity.org.za/article/illegal-mining-impact-on-infrastructure-and-the-economy-2026-08-14
* Miningmx, "SA's illegal miners face R100m fines, 30 years jail", 11 Aug 2026. https://miningmx.com/news/markets/2026-08-11-sa-s-illegal-miners-face-r100m-fines-30-years-jail/
* Department of Justice, Draft General (Mining) Laws Amendment Bill, 2026 (GG 55166). https://www.justice.gov.za/legislation/invitations/20260807-gg55166gon4088-GMLA-Bill%202026.pdf
* Polity, "Proposed illegal mining laws raise serious questions about enforcement capacity", 11 Sep 2026. https://www.polity.org.za/article/proposed-illegal-mining-laws-raise-serious-questions-about-enforcement-capacity-2026-09-11
* IOL, "Cabinet approves landmark Mineral Resources Development Bill for public comment", 15 May 2025. https://iol.co.za/business-report/2025-05-15-cabinet-approves-landmark-mineral-resources-development-bill-for-public-comment/
* TimesLIVE, "Two soldiers killed in mine fall, SANDF confirms", 17 Jul 2026. https://www.timeslive.co.za/news/south-africa/2026-07-17-two-soldiers-killed-in-mine-fall-sandf-confirms/
* Mining Weekly, "JMC mourns two SANDF members, calls for urgent rehabilitation of abandoned mines", 20 Jul 2026. https://www.miningweekly.com/article/jmc-mourns-two-sandf-members-calls-for-urgent-rehabilitation-of-abandoned-mines-2026-07-20
* Mining Weekly, "Mines Ministry hails India's satellite-based illegal mining monitoring a success", 2017. https://www.miningweekly.com/article/mines-ministry-hails-indias-satellite-based-illegal-mining-monitoring-a-success-2017-05-25
* The Wire, "A system to identify illegal mining raises hundreds of alerts, governments sleep on half of them". https://thewire.in/political-economy/a-system-to-identify-illegal-mining-raises-hundreds-of-alerts-governments-sleep-on-half-of-them
* Africa Briefing, "Ghana AI drones galamsey crackdown". https://africabriefing.com/ghana-ai-drones-galamsey-crackdown/
* SERVIR-West Africa / CERSGIS, Galamsey monitoring flyer. https://servir.icrisat.org/wp-content/uploads/2024/08/Galamsey-flyer.pdf
* Rainforest Connection, Guardian. https://rfcx.org/guardian · Reuters Events coverage. https://www.reutersevents.com/sustainability/node/58033
* Cisco Newsroom, "Saving endangered species one network at a time", Apr 2025. https://newsroom.cisco.com/c/r/newsroom/en/us/a/y2025/m04/saving-endangered-species-one-network-at-a-time.html
* NTT, Connected Conservation case study. https://services.global.ntt/about-us/case-studies/connected-conservation
* Johns Hopkins (IGARSS 2012), seismic human vs quadruped footstep classification. https://engineering.jhu.edu/vpatel36/wp-content/uploads/2018/08/IGARSS2012_Final.pdf
* SPIE 7693, "Time-domain classification of humans using seismic sensors". https://neurophotonics.spiedigitallibrary.org/conference-proceedings-of-spie/7693/769311/Time-domain-classification-of-humans-using-seismic-sensors/10.1117/12.850092.full
* Jin, Sarkar, Ray et al. (2012), symbolic dynamic filtering for seismic target classification. https://www.me.psu.edu/ray/journalAsokRay/2012/236JinSarkarRayGuptaDamarla12.pdf
* Semtech AN1200.13, *LoRa Modem Designer's Guide* (time-on-air formula).
* RFC 3610 (*Counter with CBC-MAC*), FIPS-197 (AES), RFC 4303 §3.4.3 (anti-replay window), OASIS MQTT 3.1.1, RFC 7807 (Problem Details).

> **Verification note:** figures above come from press reports and official statements as cited. Several are estimates (e.g. the R60 bn cost). The primary AGSA report and gazetted bill texts should be consulted before any figure is used in an official submission.
