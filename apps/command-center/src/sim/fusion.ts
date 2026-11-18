/**
 * Bayesian log-odds evidence fusion with exponential decay to the prior
 * (mirrors ml/sentinel_ml/fusion/bayes.py):
 *   L_t = L₀ + 2^(−Δt/T½)·(L_{t−1} − L₀) + ρ·c·log(DR/FAR)
 */
export interface SensorModel {
  detectionRate: number;
  falseAlarmRate: number;
}

export type Modality = 'seismic' | 'pir' | 'acoustic' | 'tamper' | 'satellite';

export const logit = (p: number): number => {
  const q = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  return Math.log(q / (1 - q));
};

export const sigmoid = (x: number): number => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));

export class EvidenceFuser {
  private readonly l0: number;
  private logOdds: number;
  private lastT: number | null = null;

  constructor(
    readonly prior: number,
    readonly models: Record<Modality, SensorModel>,
    readonly halfLifeS = 120,
    /** Negative evidence may lower belief at most this many log-odds below the prior:
     *  hearing animals is weak evidence that nobody else is there (absence of evidence). */
    readonly floorBelowPrior = 2.5,
  ) {
    this.l0 = logit(prior);
    this.logOdds = this.l0;
  }

  private decayTo(t: number): void {
    if (this.lastT !== null && t > this.lastT) {
      const lam = 2 ** (-(t - this.lastT) / this.halfLifeS);
      this.logOdds = this.l0 + lam * (this.logOdds - this.l0);
    }
    this.lastT = this.lastT === null ? t : Math.max(this.lastT, t);
  }

  update(t: number, modality: Modality, detected: boolean, confidence = 1, redundancy = 1): number {
    this.decayTo(t);
    const m = this.models[modality];
    const llr = detected
      ? Math.log(m.detectionRate / m.falseAlarmRate)
      : Math.log((1 - m.detectionRate) / (1 - m.falseAlarmRate));
    this.logOdds += redundancy * Math.min(1, Math.max(0, confidence)) * llr;
    this.logOdds = Math.max(this.logOdds, this.l0 - this.floorBelowPrior);
    return this.probability;
  }

  /** Add a pre-computed log-likelihood ratio (used by per-window decision fusion). */
  addLogOdds(t: number, llr: number): number {
    this.decayTo(t);
    this.logOdds = Math.max(this.logOdds + llr, this.l0 - this.floorBelowPrior);
    return this.probability;
  }

  probabilityAt(t: number): number {
    this.decayTo(t);
    return this.probability;
  }

  get probability(): number {
    return sigmoid(this.logOdds);
  }
}
