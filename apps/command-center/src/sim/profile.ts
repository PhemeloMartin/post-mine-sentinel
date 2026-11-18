import { MODEL_CARD } from '@/data/registry';

/** What the simulated edge classifier "is": derived from the trained model card. */
export interface ClassifierProfile {
  classes: string[];
  threat: Set<number>;
  threshold: number;
  /** Row-normalised confusion matrix P(predicted | true). */
  confusion: number[][];
  detectionRate: number;
  falseAlarmRate: number;
}

export function normaliseRows(m: number[][]): number[][] {
  return m.map((row) => {
    const s = row.reduce((a, b) => a + b, 0) || 1;
    return row.map((v) => v / s);
  });
}

export function profileFromModelCard(variant: 'calibrated' | 'uncalibrated'): ClassifierProfile {
  const ev = MODEL_CARD.evaluation['mlp_edge'];
  const block = variant === 'calibrated' ? ev.test : ev.test_shift;
  return {
    classes: MODEL_CARD.classes,
    threat: new Set(MODEL_CARD.threat_classes.map((c) => MODEL_CARD.classes.indexOf(c))),
    threshold: MODEL_CARD.alarm_threshold,
    confusion: normaliseRows(block.confusion_matrix),
    detectionRate: block.detection_rate,
    falseAlarmRate: Math.max(block.false_alarm_rate, 0.005),
  };
}
