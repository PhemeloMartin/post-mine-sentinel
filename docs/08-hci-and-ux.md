# 8. Human-computer interaction and UX

The console is used **at night, under stress, by people making safety-critical decisions**. HCI is therefore a safety requirement, not decoration.

## 8.1 Personas

| Persona | Context | Needs | Design response |
|---|---|---|---|
| **Thandi, SOC analyst** (KOSH SOC, night shift) | Watches 16 sites; many interruptions | Trust in alerts; quick triage; defensible decisions | Fused probability (not raw sensor noise); persistence gate against flicker; explainable RAI; event stream with plain-language entries |
| **Sipho, SAPS field officer** | Tablet in a vehicle; low light | Where exactly, how many, is it safe? | TDOA fix with uncertainty ellipse; tamper and jamming flags on the alert card; safe-egress guidance |
| **Ms Naidoo, auditor** | Quarterly review | Prove nothing was altered | One-click audit-chain verification; signature verification endpoint |
| **Kabelo, community liaison** | Public meetings | Safety information without endangering anyone | Generalised map (~5 km), no risk scores, plain wording about restrictions |

## 8.2 Nielsen's ten heuristics applied

| Heuristic | Where |
|---|---|
| Visibility of system status | Live/Demo connection chip, SAST clock, site clock, packet delivery %, node strip, alert lifecycle stepper |
| Match with the real world | SA vocabulary (SOC, SAPS, Mine Rescue, provinces, SAST); a physical headframe, fence and footpaths in the twin |
| User control and freedom | Pause, restart and speed controls; camera presets; "Reload view" in every error boundary; close dossier |
| Consistency and standards | One colour and glyph language for status and risk across map, tables and charts; RFC 7807 errors everywhere |
| Error prevention | Server-side state machines (cannot acknowledge twice; cannot refer without evidence); disabled buttons for unauthorised actions |
| Recognition rather than recall | Legends, tooltips on every node, "What to watch" text per scenario, factor bars instead of bare numbers |
| Flexibility and efficiency | Sort, filter and search in the risk register; speed presets (1×–90×); deep links (`/site/ZA-NW-002`, `/intel?site=…`) |
| Aesthetic and minimalist design | Dark HUD that keeps the 3D scene primary; panels show only decision-relevant metrics |
| Help users recover from errors | Toasts with human messages, plus the trace ID for support; offline fallback with bundled data |
| Help and documentation | Scenario descriptions; formulas shown beside the link-budget calculator; docs folder |

## 8.3 Accessibility (WCAG 2.2 AA intent)

* **Not colour alone (1.4.1):** every status has a glyph (●◐◆▲✖✚) and a text label; risk bands are labelled.
* **Keyboard (2.1.1) and focus visible (2.4.7):** native buttons, inputs and selects; `focus-visible` rings; a "Skip to main content" link.
* **Name, role, value (4.1.2):** `aria-pressed` on toggles, `role="radiogroup"` for scenarios and roles, `role="meter"` for bars, `aria-live` regions for toasts, `role="alert"` for errors.
* **Motion (2.3.3):** `prefers-reduced-motion` disables auto-orbit and star drift, and collapses CSS animations; charts don't animate.
* **Contrast (1.4.3):** light text on near-black panels; chart colours chosen for dark backgrounds.

## 8.4 Designing against alarm fatigue

Alarm fatigue is a documented cause of missed events in control rooms. The design attacks it at the source:
1. **Edge filtering**: only triggered windows are classified and reported.
2. **Fusion, not raw alarms**: votes are combined per window (with a √n correlation discount) into one probability.
3. **Persistence**: two consecutive windows above 90 % are required (tamper is the exception).
4. **Measured false-alarm rate**: 0 in 80 calibrated benign runs; the "uncalibrated" toggle *shows* operators why commissioning matters.

## 8.5 The "hidden in plain sight" interaction

The Site Twin opens in **Plain sight** mode: at a normal viewing distance the sensors are as hard to spot as real spiders, which is the point. **Sensors revealed** makes the webs (the antennas) glow, shows the 45 m detection rings and the SilkNet routing tree, and labels each node with its last class and battery. **Underground** turns the ground into an x-ray layer to show levels, drifts, stopes and crews working below.

## 8.6 Evaluation plan

* Think-aloud usability sessions with 5 analysts per iteration (Nielsen's "5 users find ~85 % of problems").
* System Usability Scale (SUS) target ≥ 75.
* Task metrics: time to locate the highest-risk dormant site in a province (target < 20 s); time from alert to dispatch decision (target < 60 s).
* Accessibility audit with axe-core and a screen reader before production.
