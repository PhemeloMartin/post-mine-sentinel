import { describe, expect, it } from 'vitest';
import { priorFromRai, SiteSimulation } from './engine';
import { profileFromModelCard } from './profile';
import { SCENARIO_BY_ID } from './scenarios';

const run = (id: string, seed = 1, rai = 83.5) => {
  const sim = new SiteSimulation({
    scenario: SCENARIO_BY_ID.get(id)!,
    prior: priorFromRai(rai),
    profile: profileFromModelCard('calibrated'),
    seed,
  });
  while (!sim.state.finished) sim.step(5);
  return sim.state;
};

describe('scenario acceptance tests', () => {
  it('night incursion raises an alert soon after people approach the fence', () => {
    const s = run('night-incursion');
    expect(s.metrics.alertsRaised).toBeGreaterThanOrEqual(1);
    expect(s.metrics.falseAlarms).toBe(0);
    expect(s.metrics.detectionLatency).not.toBeNull();
    expect(s.metrics.detectionLatency!).toBeLessThan(120);
    expect(s.metrics.fixes).toBeGreaterThan(0);
  });

  it('quiet night with jackals and wind stays silent across seeds', () => {
    for (const seed of [1, 2, 3]) {
      const s = run('quiet-night', seed);
      expect(s.metrics.alertsRaised).toBe(0);
    }
  });

  it('grazing cattle trip PIR but do not cause an alert', () => {
    const s = run('livestock', 4);
    expect(s.metrics.benignReports).toBeGreaterThan(0);
    expect(s.metrics.falseAlarms).toBe(0);
  });

  it('an underground blast is detected and located near the shaft', () => {
    const s = run('underground-blast', 5);
    expect(s.metrics.alertsRaised).toBeGreaterThanOrEqual(1);
    const fixes = s.fixes.filter((f) => f.underground);
    expect(fixes.length).toBeGreaterThan(0);
    expect(Math.hypot(fixes[0].x, fixes[0].z)).toBeLessThan(120);
  });

  it('a tamper attempt is flagged and the mesh heals around the lost node', () => {
    const s = run('tamper', 6);
    expect(s.nodes.find((n) => n.id === 'S21')!.status).toBe('tampered');
    expect(s.log.some((l) => l.msg.includes('TAMPER'))).toBe(true);
  });

  it('jamming anchor A1 re-routes traffic through A2 and keeps delivering', () => {
    const s = run('gateway-jam', 7);
    expect(s.metrics.rerouted).toBeGreaterThan(0);
    expect(s.nodes.filter((n) => n.status !== 'tampered').every((n) => n.parent !== 'A1')).toBe(true);
    const pdr = s.metrics.packetsDelivered / s.metrics.packetsGenerated;
    expect(pdr).toBeGreaterThan(0.75);
    expect(s.metrics.alertsRaised).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic for a given seed', () => {
    const a = run('night-incursion', 9);
    const b = run('night-incursion', 9);
    expect(a.metrics).toEqual(b.metrics);
  });
});
