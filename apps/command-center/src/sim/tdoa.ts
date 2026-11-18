/**
 * TDOA multilateration by Levenberg–Marquardt on θ = (x, z, t₀)
 * (mirrors ml/sentinel_ml/fusion/tdoa.py):
 *   r_i = t_i − t₀ − ‖p − s_i‖/v,   Σ_θ = σ_t² (JᵀJ)⁻¹
 */
export interface TdoaInput {
  x: number;
  z: number;
  t: number;
}

export interface TdoaResult {
  x: number;
  z: number;
  t0: number;
  /** 1-σ error ellipse */
  semiMajor: number;
  semiMinor: number;
  angle: number;
  rmsS: number;
  converged: boolean;
}

function solve3(a: number[][], b: number[]): number[] | null {
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-18) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

function inverse3(a: number[][]): number[][] | null {
  const cols = [0, 1, 2].map((i) => solve3(a, [0, 1, 2].map((j) => (i === j ? 1 : 0))));
  if (cols.some((c) => c === null)) return null;
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => (cols[c] as number[])[r]));
}

export function multilaterate(obs: TdoaInput[], velocity = 300, sigmaT = 1e-3): TdoaResult | null {
  if (obs.length < 3) return null;
  const tMin = Math.min(...obs.map((o) => o.t));
  let wsum = 0;
  let x = 0;
  let z = 0;
  for (const o of obs) {
    const w = Math.exp(-((o.t - tMin) * velocity) / 20);
    wsum += w;
    x += w * o.x;
    z += w * o.z;
  }
  x /= wsum;
  z /= wsum;
  let t0 = obs.reduce((s, o) => s + o.t - Math.hypot(o.x - x, o.z - z) / velocity, 0) / obs.length;

  const evalAt = (px: number, pz: number, pt: number) => {
    const r: number[] = [];
    const j: number[][] = [];
    for (const o of obs) {
      const dx = px - o.x;
      const dz = pz - o.z;
      const d = Math.max(Math.hypot(dx, dz), 1e-6);
      r.push(o.t - pt - d / velocity);
      j.push([-dx / (velocity * d), -dz / (velocity * d), -1]);
    }
    return { r, j, cost: r.reduce((s, v) => s + v * v, 0) };
  };

  let cur = evalAt(x, z, t0);
  let mu = 1e-3;
  let converged = false;
  for (let it = 0; it < 60; it++) {
    const jtj = [0, 1, 2].map((a) => [0, 1, 2].map((b) => cur.j.reduce((s, row) => s + row[a] * row[b], 0)));
    const jtr = [0, 1, 2].map((a) => cur.j.reduce((s, row, i) => s + row[a] * cur.r[i], 0));
    const damped = jtj.map((row, i) => row.map((v, k) => (i === k ? v + mu * (v + 1e-12) : v)));
    const step = solve3(damped, jtr.map((v) => -v));
    if (!step) break;
    const cand = evalAt(x + step[0], z + step[1], t0 + step[2]);
    if (cand.cost < cur.cost) {
      x += step[0];
      z += step[1];
      t0 += step[2];
      cur = cand;
      mu = Math.max(mu / 3, 1e-9);
      if (Math.hypot(step[0], step[1]) < 1e-4) {
        converged = true;
        break;
      }
    } else {
      mu *= 4;
      if (mu > 1e8) break;
    }
  }
  const jtj = [0, 1, 2].map((a) => [0, 1, 2].map((b) => cur.j.reduce((s, row) => s + row[a] * row[b], 0)));
  const inv = inverse3(jtj);
  const rms = Math.sqrt(cur.cost / obs.length);
  let semiMajor = Infinity;
  let semiMinor = Infinity;
  let angle = 0;
  if (inv) {
    const sxx = sigmaT ** 2 * inv[0][0];
    const szz = sigmaT ** 2 * inv[1][1];
    const sxz = sigmaT ** 2 * inv[0][1];
    const tr = sxx + szz;
    const det = sxx * szz - sxz * sxz;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    semiMajor = Math.sqrt(Math.max(0, tr / 2 + disc));
    semiMinor = Math.sqrt(Math.max(0, tr / 2 - disc));
    angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  }
  return { x, z, t0, semiMajor, semiMinor, angle, rmsS: rms, converged: converged || rms < 5 * sigmaT };
}
