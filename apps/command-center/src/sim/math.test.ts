import { describe, expect, it } from 'vitest';
import { EvidenceFuser } from './fusion';
import { linkBudget, phi, sensitivityDbm, timeOnAir } from './lora';
import { multilaterate } from './tdoa';
import { Rng } from './rng';

const models = {
  seismic: { detectionRate: 0.95, falseAlarmRate: 0.02 },
  pir: { detectionRate: 0.7, falseAlarmRate: 0.05 },
  acoustic: { detectionRate: 0.75, falseAlarmRate: 0.04 },
  tamper: { detectionRate: 0.9, falseAlarmRate: 0.005 },
  satellite: { detectionRate: 0.55, falseAlarmRate: 0.08 },
};

describe('LoRa maths (parity with the Python netsim)', () => {
  it('matches the Semtech airtime reference for SF7/125 kHz/10 B', () => {
    expect(timeOnAir(10, 7) * 1000).toBeCloseTo(41.216, 2);
  });
  it('computes receiver sensitivity', () => {
    expect(sensitivityDbm(12)).toBeCloseTo(-174 + 10 * Math.log10(125e3) + 6 - 20, 6);
  });
  it('normal CDF is accurate', () => {
    expect(phi(0)).toBeCloseTo(0.5, 6);
    expect(phi(1.96)).toBeCloseTo(0.975, 3);
    expect(phi(-1.96)).toBeCloseTo(0.025, 3);
  });
  it('link margin shrinks with distance', () => {
    const base = { sf: 9, txDbm: 14, gainDbi: 2, exponent: 3, payloadBytes: 24, dutyCycle: 0.01 };
    expect(linkBudget({ ...base, distanceM: 100 }).marginDb).toBeGreaterThan(linkBudget({ ...base, distanceM: 1000 }).marginDb);
  });
});

describe('Bayesian fusion', () => {
  it('rises with evidence and decays to the prior', () => {
    const f = new EvidenceFuser(0.05, models, 60);
    const p = f.update(0, 'seismic', true);
    expect(p).toBeGreaterThan(0.05);
    expect(f.probabilityAt(10_000)).toBeCloseTo(0.05, 3);
  });
  it('negative evidence lowers belief', () => {
    const f = new EvidenceFuser(0.3, models);
    expect(f.update(0, 'seismic', false)).toBeLessThan(0.3);
  });
});

describe('TDOA multilateration', () => {
  it('recovers a footstep source within 1.5 m', () => {
    const rng = new Rng(7);
    const sensors = [
      [-40, -40],
      [40, -35],
      [45, 40],
      [-35, 45],
      [0, 60],
    ];
    const src = [12, -7];
    const obs = sensors.map(([x, z]) => ({ x, z, t: 2 + Math.hypot(x - src[0], z - src[1]) / 300 + rng.normal(0, 2e-4) }));
    const fix = multilaterate(obs, 300, 2e-4)!;
    expect(fix.converged).toBe(true);
    expect(Math.hypot(fix.x - src[0], fix.z - src[1])).toBeLessThan(1.5);
    expect(fix.semiMajor).toBeGreaterThanOrEqual(fix.semiMinor);
  });
  it('needs at least three observations', () => {
    expect(multilaterate([{ x: 0, z: 0, t: 0 }], 300)).toBeNull();
  });
});
