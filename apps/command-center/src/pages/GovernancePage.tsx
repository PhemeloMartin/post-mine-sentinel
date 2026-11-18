import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { CheckCircle2, Hash, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Panel } from '@/components/ui';
import { buildChain, verifyChain, type AuditEntry } from '@/lib/auditChain';
import { PERMISSIONS, can, useSession } from '@/store/session';
import type { Role } from '@/types';

const SEED: Omit<AuditEntry, 'hash' | 'prev'>[] = [
  { seq: 1, at: '2026-11-18T21:58:04+02:00', actor: 'analyst.kosh', role: 'analyst', action: 'auth.login', resource: 'session', outcome: 'allow' },
  { seq: 2, at: '2026-11-18T22:02:41+02:00', actor: 'analyst.kosh', role: 'analyst', action: 'site.view', resource: 'ZA-NW-002', outcome: 'allow' },
  { seq: 3, at: '2026-11-18T23:07:12+02:00', actor: 'fusion-engine', role: 'service', action: 'alert.raise', resource: 'ALR-0001', outcome: 'allow' },
  { seq: 4, at: '2026-11-18T23:07:32+02:00', actor: 'analyst.kosh', role: 'analyst', action: 'alert.acknowledge', resource: 'ALR-0001', outcome: 'allow' },
  { seq: 5, at: '2026-11-18T23:07:57+02:00', actor: 'analyst.kosh', role: 'analyst', action: 'case.dispatch', resource: 'CASE-2026-0412', outcome: 'allow' },
  { seq: 6, at: '2026-11-18T23:15:03+02:00', actor: 'liaison.matlosana', role: 'community_liaison', action: 'site.precise_location', resource: 'ZA-NW-002', outcome: 'deny' },
  { seq: 7, at: '2026-11-19T08:30:11+02:00', actor: 'officer.saps', role: 'field_officer', action: 'evidence.export', resource: 'EVD-7731', outcome: 'allow' },
  { seq: 8, at: '2026-11-19T09:12:45+02:00', actor: 'auditor.agsa', role: 'auditor', action: 'audit.verify', resource: 'audit-log', outcome: 'allow' },
];

const PERMS = ['view_all', 'view_generalised', 'precise_location', 'live_alerts', 'plan_inspections', 'update_cases', 'manage_nodes', 'manage_users', 'view_audit', 'export'];

const COMPLIANCE = [
  ['Constitution s14 & s24', 'Privacy; environment not harmful to health', 'Monitors land and vibration, not people; supports rehabilitation of hazardous shafts', 'Designed'],
  ['POPIA (Act 4 of 2013)', '8 conditions; s19 security safeguards; s22 breach notification; s26/s33 criminal-behaviour data; s72 cross-border', 'No biometric/audio content leaves nodes; RBAC + location generalisation; encryption; breach runbook; hosting in Azure South Africa North', 'Designed'],
  ['MPRDA (Act 28 of 2002) s5A, s43, s46', 'No mining without a right; closure obligations; State duty for derelict & ownerless mines', 'Evidence for enforcement; prioritised rehabilitation list for DMPR & CGS', 'Supports'],
  ['General (Mining) Laws Amendment Bill, 2026 (draft)', 'Proposed s5B (assisting illegal mining); higher penalties; CPA Schedule 1', 'Chain-of-custody evidence model ready; tracks bill status — no reliance until enacted', 'Monitoring'],
  ['Mine Health and Safety Act (29 of 1996)', 'Safety of persons at mines', 'Safe-egress protocol: alerts route to Mine Rescue Services; no underground pursuit', 'Designed'],
  ['Cybercrimes Act (19 of 2020)', 'Unlawful access/interference offences; evidence preservation', 'Hardened devices, signed firmware, audit trail for forensic use', 'Designed'],
  ['ECTA (25 of 2002) s15', 'Admissibility & weight of data messages', 'SHA-256 hash-chained audit, Ed25519-signed alerts & evidence', 'Designed'],
  ['Criminal Procedure Act (51 of 1977) s212', 'Affidavit evidence of technical facts', 'Evidence bundles export with signatures and chain of custody (case service)', 'Designed'],
  ['RICA (70 of 2002)', 'No interception of communications', 'Acoustic channel computes features on-device; no speech is recorded or transmitted', 'Designed'],
  ['ECA & ICASA Radio Frequency Spectrum Regulations', 'Licence-exempt SRD band conditions (power, duty cycle)', '868 MHz plan, ≤ 1 % duty cycle enforced in firmware; type approval before deployment', 'To verify'],
  ['PSIRA Act (56 of 2001)', 'Registration of security service providers', 'Operating entity to register before selling monitoring to private clients', 'To action'],
  ['Critical Infrastructure Protection Act (8 of 2019)', 'Protection of declared critical infrastructure', 'Network designed to CIP-grade controls (ISO 27001 / NIST CSF 2.0 mapping)', 'Designed'],
  ['PAIA (2 of 2000)', 'Access to information', 'Request templates for SAMINDABA/D&O data; manual for the operator', 'Drafted'],
  ['SACAA Part 101', 'Remotely piloted aircraft', 'Drone verification flights only by licensed operators (future phase)', 'Future'],
];

const RETENTION = [
  ['Raw vibration windows', 'Never leave the node (features only)', 'Data minimisation'],
  ['Telemetry & heartbeats', '13 months, then aggregated', 'Trend analysis, SLAs'],
  ['Detections & fused alerts', '5 years', 'Pattern analysis, evaluation'],
  ['Evidence bundles (signed)', 'Life of case + 5 years', 'Prosecution & appeals'],
  ['Audit log', '7 years, WORM storage', 'Accountability, AGSA'],
  ['User accounts', 'Deactivate on exit; purge after 2 years', 'POPIA s14'],
];

export function GovernancePage() {
  const role = useSession((s) => s.session?.role);
  const [chain, setChain] = useState<AuditEntry[]>([]);
  const [verdict, setVerdict] = useState<{ ok: boolean; index: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    buildChain(SEED)
      .then(setChain)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Web Crypto unavailable (requires a secure context)'));
  }, []);

  const verify = async () => {
    try {
      const idx = await verifyChain(chain);
      setVerdict({ ok: idx === -1, index: idx });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const tamper = () => {
    setChain((c) => c.map((e, i) => (i === 5 ? { ...e, outcome: 'allow' } : e)));
    setVerdict(null);
  };
  const reset = async () => {
    setChain(await buildChain(SEED));
    setVerdict(null);
  };

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Role-based access control (least privilege)">
          <div className="overflow-x-auto">
            <table className="w-full text-center text-[11px]">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1 text-left font-medium">Permission</th>
                  {(Object.keys(PERMISSIONS) as Role[]).map((r) => (
                    <th key={r} className={clsx('px-1 font-medium', r === role && 'text-cyan-300')}>
                      {r.replace('_', ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMS.map((p) => (
                  <tr key={p} className="border-t border-slate-800">
                    <td className="py-1 text-left font-mono text-slate-300">{p}</td>
                    {(Object.keys(PERMISSIONS) as Role[]).map((r) => (
                      <td key={r} className={clsx(r === role && 'bg-cyan-400/5')}>
                        {can(r, p) ? <CheckCircle2 size={13} className="mx-auto text-emerald-400" aria-label="allowed" /> : <span className="text-slate-700" aria-label="denied">·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Enforced server-side on every request (FastAPI dependency + ASP.NET Core policies); the UI only mirrors it. Community liaisons see coordinates generalised to a ~5 km grid so the
            platform can never become a map for syndicates.
          </p>
        </Panel>

        <Panel
          title="Tamper-evident audit log (SHA-256 hash chain)"
          actions={
            <div className="flex gap-1.5">
              <button className="hud-btn" onClick={verify} disabled={!chain.length}>
                <ShieldCheck size={13} /> Verify
              </button>
              <button className="hud-btn" onClick={tamper} disabled={!can(role, 'view_audit') && role !== 'analyst'}>
                <ShieldAlert size={13} /> Simulate tampering
              </button>
              <button className="hud-btn" onClick={reset}>
                Reset
              </button>
            </div>
          }
        >
          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          {verdict && (
            <div
              role="status"
              className={clsx('mb-2 rounded-md border p-2 text-xs', verdict.ok ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' : 'border-red-500/60 bg-red-500/10 text-red-200')}
            >
              {verdict.ok ? 'Chain verified: all entries intact.' : `Integrity failure at entry #${verdict.index + 1}: the log was altered after it was written.`}
            </div>
          )}
          <ol className="space-y-1">
            {chain.map((e, i) => (
              <li key={e.seq} className={clsx('rounded-md border px-2 py-1 text-[11px]', verdict && !verdict.ok && i >= verdict.index ? 'border-red-500/50' : 'border-slate-800')}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-500">#{e.seq}</span>
                  <span className="text-slate-200">{e.action}</span>
                  <span className="text-slate-500">{e.resource}</span>
                  <span className={clsx('ml-auto font-mono uppercase', e.outcome === 'deny' ? 'text-red-300' : 'text-emerald-300')}>{e.outcome}</span>
                </div>
                <div className="flex items-center gap-1 font-mono text-[9.5px] text-slate-500">
                  <Hash size={10} /> {e.hash?.slice(0, 32)}… ← {e.prev?.slice(0, 12)}…
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="South African legal & regulatory compliance map" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Instrument</th>
                  <th className="pr-3 font-medium">Obligation</th>
                  <th className="pr-3 font-medium">How Post-Mine Sentinel complies</th>
                  <th className="font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {COMPLIANCE.map(([law, ob, how, st]) => (
                  <tr key={law} className="border-t border-slate-800 align-top">
                    <td className="py-1.5 pr-3 font-medium text-slate-100">{law}</td>
                    <td className="pr-3 text-slate-400">{ob}</td>
                    <td className="pr-3 text-slate-300">{how}</td>
                    <td>
                      <span
                        className={clsx(
                          'hud-chip',
                          st === 'Designed' || st === 'Supports' ? 'border-emerald-400/50 text-emerald-300' : st === 'Future' ? 'border-slate-500 text-slate-400' : 'border-amber-400/50 text-amber-300',
                        )}
                      >
                        {st}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">Prototype compliance analysis, not legal advice. Obtain a formal legal opinion and ICASA type approval before deployment.</p>
        </Panel>

        <Panel title="Data retention schedule (POPIA s14)">
          <table className="w-full text-left text-[11px]">
            <tbody>
              {RETENTION.map(([what, how, why]) => (
                <tr key={what} className="border-t border-slate-800">
                  <td className="py-1.5 pr-3 text-slate-200">{what}</td>
                  <td className="pr-3 font-mono text-cyan-200">{how}</td>
                  <td className="text-slate-500">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Ethics charter">
          <ul className="list-disc space-y-1.5 pl-4 text-[11px] text-slate-300">
            <li>
              <b className="text-slate-100">Safety first, not manhunts.</b> Many illegal miners are trafficked or coerced. Alerts trigger safe egress and shaft sealing, never underground pursuit.
            </li>
            <li>
              <b className="text-slate-100">Land, not people.</b> Nodes classify vibration on-device; no faces, voices or identities are captured.
            </li>
            <li>
              <b className="text-slate-100">Human in the loop.</b> An alert is a reason to inspect, never proof of a crime.
            </li>
            <li>
              <b className="text-slate-100">Need to know.</b> Active-site locations only for cleared roles; every view is audited.
            </li>
            <li>
              <b className="text-slate-100">Honest models.</b> Synthetic training data and domain-shift results are published in the model card.
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
