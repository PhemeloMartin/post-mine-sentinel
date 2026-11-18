/**
 * Tamper-evident audit log (same construction as services/api/app/core/audit.py):
 *   h_0 = SHA-256("GENESIS")
 *   h_i = SHA-256(h_{i−1} ‖ canonical_json(entry_i))
 * Any edit, insertion or deletion breaks every subsequent link, so an auditor can prove the
 * log was not rewritten — supporting ECTA s15 (admissibility of data messages) and CPA s212.
 */
export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  role: string;
  action: string;
  resource: string;
  outcome: 'allow' | 'deny';
  hash?: string;
  prev?: string;
}

/** Canonical JSON: sorted keys, no whitespace (mirrors json.dumps(sort_keys=True, separators=(',', ':'))). */
export function canonical(e: Omit<AuditEntry, 'hash' | 'prev'>): string {
  const obj = e as unknown as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`)
    .join(',')}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildChain(entries: Omit<AuditEntry, 'hash' | 'prev'>[]): Promise<AuditEntry[]> {
  let prev = await sha256Hex('GENESIS');
  const out: AuditEntry[] = [];
  for (const e of entries) {
    const hash = await sha256Hex(prev + canonical(e));
    out.push({ ...e, prev, hash });
    prev = hash;
  }
  return out;
}

/** Returns the index of the first broken link, or −1 if the chain verifies. */
export async function verifyChain(chain: AuditEntry[]): Promise<number> {
  let prev = await sha256Hex('GENESIS');
  for (let i = 0; i < chain.length; i++) {
    const { hash, prev: storedPrev, ...body } = chain[i];
    if (storedPrev !== prev) return i;
    const expect = await sha256Hex(prev + canonical(body));
    if (expect !== hash) return i;
    prev = hash!;
  }
  return -1;
}
