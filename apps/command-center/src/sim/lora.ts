/**
 * LoRa PHY maths (mirrors ml/sentinel_ml/netsim/lora.py — same formulas, same tests).
 *   ToA     = (n_pre + 4.25)·T_sym + n_payload·T_sym, T_sym = 2^SF / BW   (Semtech AN1200.13)
 *   S [dBm] = −174 + 10·log10(BW) + NF + SNR_min(SF)
 *   PL(d)   = FSPL(1 m) + 10·n·log10(d)
 */
export const SNR_MIN_DB: Record<number, number> = { 7: -7.5, 8: -10, 9: -12.5, 10: -15, 11: -17.5, 12: -20 };

export function timeOnAir(payloadBytes: number, sf = 9, bwHz = 125e3, cr = 1, preamble = 8, crc = true): number {
  const tSym = 2 ** sf / bwHz;
  const de = tSym > 0.016 ? 1 : 0;
  const num = 8 * payloadBytes - 4 * sf + 28 + 16 * (crc ? 1 : 0);
  const den = 4 * (sf - 2 * de);
  const nPayload = 8 + Math.max(Math.ceil(num / den) * (cr + 4), 0);
  return (preamble + 4.25) * tSym + nPayload * tSym;
}

export function sensitivityDbm(sf: number, bwHz = 125e3, nf = 6): number {
  return -174 + 10 * Math.log10(bwHz) + nf + SNR_MIN_DB[sf];
}

export function fsplDb(distanceM: number, freqHz = 868e6): number {
  return 20 * Math.log10(Math.max(distanceM, 1e-3)) + 20 * Math.log10(freqHz) - 147.55;
}

export function pathLossDb(distanceM: number, exponent = 3, freqHz = 868e6): number {
  return fsplDb(1, freqHz) + 10 * exponent * Math.log10(Math.max(distanceM, 1));
}

/** Standard normal CDF via the Abramowitz–Stegun erf approximation (|ε| < 1.5e-7). */
export function phi(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + Math.sign(x) * y);
}

export interface LinkBudgetResult {
  pathLossDb: number;
  rxDbm: number;
  sensitivityDbm: number;
  marginDb: number;
  toaMs: number;
  maxPacketsPerHour: number;
  maxRangeM: number;
}

export function linkBudget(opts: {
  distanceM: number;
  sf: number;
  txDbm: number;
  gainDbi: number;
  exponent: number;
  payloadBytes: number;
  dutyCycle: number;
  fadeMarginDb?: number;
}): LinkBudgetResult {
  const pl = pathLossDb(opts.distanceM, opts.exponent);
  const rx = opts.txDbm + 2 * opts.gainDbi - pl;
  const sens = sensitivityDbm(opts.sf);
  const toa = timeOnAir(opts.payloadBytes, opts.sf);
  const fade = opts.fadeMarginDb ?? 10;
  const budget = opts.txDbm + 2 * opts.gainDbi - sens - fade - fsplDb(1);
  return {
    pathLossDb: pl,
    rxDbm: rx,
    sensitivityDbm: sens,
    marginDb: rx - sens,
    toaMs: toa * 1000,
    maxPacketsPerHour: (opts.dutyCycle * 3600) / toa,
    maxRangeM: 10 ** (budget / (10 * opts.exponent)),
  };
}
