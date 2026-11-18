import { useEffect } from 'react';
import { notify } from '@/store/toasts';
import { simHolder, useSim } from '@/store/sim';
import { priorFromRai, SiteSimulation } from './engine';
import { profileFromModelCard } from './profile';
import { SCENARIO_BY_ID } from './scenarios';

/**
 * Owns the simulation lifecycle: (re)creates the engine when the scenario, site, classifier
 * profile or run changes, steps it on requestAnimationFrame, and publishes a throttled
 * snapshot for the HUD. A failure inside the engine is caught and surfaced instead of
 * freezing the page.
 */
export function useSiteSim(rai: number): void {
  const { scenarioId, profile, runId } = useSim();

  useEffect(() => {
    const scenario = SCENARIO_BY_ID.get(scenarioId);
    if (!scenario) {
      notify({ kind: 'error', title: 'Unknown scenario', detail: scenarioId });
      return;
    }
    let sim: SiteSimulation;
    try {
      sim = new SiteSimulation({ scenario, prior: priorFromRai(rai), profile: profileFromModelCard(profile), seed: 20260717 + runId });
    } catch (err) {
      notify({ kind: 'error', title: 'Simulation failed to start', detail: err instanceof Error ? err.message : String(err) });
      return;
    }
    simHolder.current = sim;
    useSim.getState().setSnapshot(sim.snapshot());

    let raf = 0;
    let last = performance.now();
    let lastPublish = 0;
    let lastAlertId: string | null = null;
    let failed = false;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); // clamp after tab switches
      last = now;
      const { playing, speed } = useSim.getState();
      if (playing && !failed) {
        try {
          sim.step(dt * speed);
        } catch (err) {
          failed = true;
          useSim.getState().setPlaying(false);
          notify({ kind: 'error', title: 'Simulation halted', detail: err instanceof Error ? err.message : String(err) }, 0);
        }
      }
      if (now - lastPublish > 200) {
        lastPublish = now;
        const snap = sim.snapshot();
        useSim.getState().setSnapshot(snap);
        if (snap.alert && snap.alert.id !== lastAlertId) {
          lastAlertId = snap.alert.id;
          notify({ kind: 'error', title: `${snap.alert.id}: intrusion alert`, detail: `P(intrusion) ${(snap.posterior * 100).toFixed(1)}% — ${snap.alert.reason}` });
        }
        if (snap.finished && useSim.getState().playing) useSim.getState().setPlaying(false);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (simHolder.current === sim) simHolder.current = null;
    };
  }, [scenarioId, profile, runId, rai]);
}
