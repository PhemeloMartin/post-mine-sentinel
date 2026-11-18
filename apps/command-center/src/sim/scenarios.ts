export type ScenarioEvent =
  | { at: number; type: 'intruders'; count: number; path: 'P1' | 'P2'; spacing: number; tamperNode?: string }
  | { at: number; type: 'undergroundCrew'; count: number }
  | { at: number; type: 'jackals'; count: number }
  | { at: number; type: 'cattle'; count: number }
  | { at: number; type: 'vehicle' }
  | { at: number; type: 'generator'; on: boolean }
  | { at: number; type: 'blast'; level: number }
  | { at: number; type: 'jam'; gateway: string; on: boolean }
  | { at: number; type: 'wind'; strength: number; duration: number }
  | { at: number; type: 'note'; text: string };

export interface Scenario {
  id: string;
  name: string;
  summary: string;
  learning: string;
  clockStart: number; // seconds after midnight
  durationS: number;
  hasThreat: boolean;
  events: ScenarioEvent[];
}

const h = (hh: number, mm = 0) => hh * 3600 + mm * 60;

export const SCENARIOS: Scenario[] = [
  {
    id: 'night-incursion',
    name: 'Night incursion',
    summary: 'Six people enter along two footpaths at 23:05, descend the open shaft and start working Level 1.',
    learning: 'Fence and path spiders detect footsteps first; TDOA tracks the group; fused probability crosses the alert line before anyone reaches the collar.',
    clockStart: h(23, 5),
    durationS: 3600,
    hasThreat: true,
    events: [
      { at: 0, type: 'jackals', count: 2 },
      { at: 0, type: 'note', text: 'Moonless night, light wind. Site prior from RAI loaded.' },
      { at: 30, type: 'intruders', count: 4, path: 'P1', spacing: 14 },
      { at: 160, type: 'intruders', count: 2, path: 'P2', spacing: 10 },
      { at: 720, type: 'generator', on: true },
      { at: 1100, type: 'vehicle' },
    ],
  },
  {
    id: 'quiet-night',
    name: 'Quiet night (false-alarm test)',
    summary: 'Only jackals and gusty wind. Nobody enters the site.',
    learning: 'Edge classification plus Bayesian fusion keeps the posterior low: the system must stay silent when nothing is wrong.',
    clockStart: h(1, 10),
    durationS: 2400,
    hasThreat: false,
    events: [
      { at: 0, type: 'jackals', count: 3 },
      { at: 300, type: 'wind', strength: 2.2, duration: 240 },
      { at: 1300, type: 'wind', strength: 1.6, duration: 180 },
    ],
  },
  {
    id: 'underground-blast',
    name: 'Illegal underground blast',
    summary: 'A crew already underground on Level 2 sets off an explosive charge at 02:04.',
    learning: 'Every spider hears the body wave; the epicentre is located below the shaft; blasting at a closed mine is unambiguous evidence.',
    clockStart: h(2, 0),
    durationS: 1500,
    hasThreat: true,
    events: [
      { at: 0, type: 'undergroundCrew', count: 3 },
      { at: 240, type: 'blast', level: 1 },
    ],
  },
  {
    id: 'livestock',
    name: 'Grazing cattle (daytime)',
    summary: 'A herd grazes along the eastern fence at mid-morning.',
    learning: 'PIR fires on the cattle, but the seismic classifier labels the gait "animal"; fused evidence stays below the alert threshold.',
    clockStart: h(10, 30),
    durationS: 1800,
    hasThreat: false,
    events: [
      { at: 0, type: 'cattle', count: 6 },
      { at: 60, type: 'jackals', count: 1 },
    ],
  },
  {
    id: 'tamper',
    name: 'Sensor tamper attempt',
    summary: 'Two people walk in; one spots the "spider" web on a rock beside the footpath (S21) and pulls the node off.',
    learning: 'The accelerometer raises a signed last-gasp tamper frame; the mesh re-routes around the lost node and the alert carries the tamper flag.',
    clockStart: h(0, 20),
    durationS: 1500,
    hasThreat: true,
    events: [{ at: 20, type: 'intruders', count: 2, path: 'P1', spacing: 8, tamperNode: 'S21' }],
  },
  {
    id: 'gateway-jam',
    name: 'Gateway jamming',
    summary: 'A syndicate jams Anchor A1 on 868 MHz before moving in.',
    learning: 'Nodes see the noise-floor jump, flag RF interference and re-parent through Anchor A2; packet delivery continues.',
    clockStart: h(22, 40),
    durationS: 1800,
    hasThreat: true,
    events: [
      { at: 30, type: 'jam', gateway: 'A1', on: true },
      { at: 90, type: 'intruders', count: 3, path: 'P1', spacing: 12 },
    ],
  },
];

export const SCENARIO_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));
