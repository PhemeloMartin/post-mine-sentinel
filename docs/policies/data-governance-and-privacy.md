# Policy: data governance and privacy

**Owner:** Information Officer · **Review:** annually · **Applies to:** all staff, contractors and systems of the operating entity.

## 1. Purpose
Process information lawfully under POPIA, protect life and property at mine sites, and prevent the platform from ever becoming a tool for surveillance of individuals or for criminal syndicates.

## 2. Data inventory and classification

| Dataset | Personal information? | Classification | Retention |
|---|---|---|---|
| Mine register, RAI, satellite indices | No | Restricted (generalised: Internal) | Indefinite (public-interest record) |
| Detections (class, probability, SNR, timing) | No (ground vibration only) | Restricted | 5 years (TimescaleDB policy) |
| Alerts and signed payloads | No (site-level) | Restricted | Life of case + 5 years |
| Case files and evidence | **Possibly**: officer names; information about alleged offences | Secret | Life of case + 5 years, or per NPA instruction |
| User accounts and audit log | Yes (staff) | Restricted | Accounts: 2 years after exit; audit: 7 years (WORM) |

## 3. Rules
1. **Minimality:** nodes transmit features and labels only. Raw signals, audio and images are never collected from sensors.
2. **Purpose limitation:** data is used only to protect life, prioritise rehabilitation and support enforcement of mining law. Any new purpose requires Information Officer approval and a legal opinion.
3. **Need to know:** precise coordinates of active alerts and sensors are visible only to roles with `precise_location`; each view is audited.
4. **Criminal-behaviour information (POPIA s26/s33):** processed only by or on behalf of SAPS / NPA within the case service.
5. **In-country processing:** production data is stored and processed in South Africa (Azure South Africa North/West).
6. **Quality:** register changes go through pull requests and pass the validation pipeline.
7. **Disclosure:** external requests are handled under PAIA; law-enforcement requests require a lawful instrument and are logged.

## 4. Data subject rights
Requests are handled by the Information Officer within statutory timelines and logged in the audit system.

## 5. Breaches
Handled under the [incident response plan](incident-response-plan.md), including notification to the Information Regulator and data subjects "as soon as reasonably possible" (POPIA s22).
