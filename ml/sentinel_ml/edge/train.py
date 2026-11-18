"""Train, compare and calibrate the S.P.I.D.E.R. node intrusion classifier.

Protocol
--------
* Four disjoint, seed-separated synthetic sets: train / validation / test (in-distribution)
  / test-shift (harder soil, higher noise; never seen in training).
* Candidate families: multinomial logistic regression, random forest, histogram gradient
  boosting and a 2-hidden-layer MLP. The MLP is the deployment target because it fits in
  ~5.3 KB of flash and ~1.3 k multiply-accumulates per 4 s window on an ESP32-S3.
* The alarm threshold on P(threat) is chosen on the *validation* set to keep the benign
  false-alarm rate ≤ 2 % (Neyman-Pearson style), then reported on both test sets.
* Calibration is reported as Expected Calibration Error (ECE, 10 bins).
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, roc_auc_score
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ..features import FEATURE_NAMES, extract_batch
from ..signals import CLASSES, THREAT_CLASSES, generate_dataset
from ..signals.synth import SHIFTED_CONDITIONS, TRAIN_CONDITIONS

TARGET_FAR = 0.02


@dataclass
class Split:
    X: np.ndarray       # features
    y: np.ndarray
    raw: np.ndarray     # int16 windows (kept for golden-vector export)


def build_splits(n_train: int = 1200, n_eval: int = 400) -> dict[str, Split]:
    plan = {
        "train": (n_train, 101, TRAIN_CONDITIONS),
        "val": (n_eval // 2 + 100, 202, TRAIN_CONDITIONS),
        "test": (n_eval, 303, TRAIN_CONDITIONS),
        "test_shift": (n_eval, 404, SHIFTED_CONDITIONS),
    }
    out = {}
    for name, (n, seed, cond) in plan.items():
        raw, y = generate_dataset(n, seed, cond)
        out[name] = Split(extract_batch(raw), y, raw)
    return out


def threat_score(proba: np.ndarray) -> np.ndarray:
    return proba[:, sorted(THREAT_CLASSES)].sum(axis=1)


def expected_calibration_error(proba: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    conf = proba.max(axis=1)
    pred = proba.argmax(axis=1)
    edges = np.linspace(0, 1, bins + 1)
    ece = 0.0
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        mask = (conf > lo) & (conf <= hi)
        if mask.any():
            ece += mask.mean() * abs((pred[mask] == y[mask]).mean() - conf[mask].mean())
    return float(ece)


def choose_threshold(scores: np.ndarray, is_threat: np.ndarray, target_far: float = TARGET_FAR) -> float:
    benign = np.sort(scores[~is_threat])
    idx = int(np.ceil((1 - target_far) * len(benign))) - 1
    return float(benign[min(max(idx, 0), len(benign) - 1)]) + 1e-6


def evaluate(model, split: Split, threshold: float) -> dict:
    proba = model.predict_proba(split.X)
    pred = proba.argmax(axis=1)
    is_threat = np.isin(split.y, list(THREAT_CLASSES))
    ts = threat_score(proba)
    alarm = ts >= threshold
    return {
        "accuracy": round(float(accuracy_score(split.y, pred)), 4),
        "macro_f1": round(float(f1_score(split.y, pred, average="macro")), 4),
        "threat_auc": round(float(roc_auc_score(is_threat, ts)), 4),
        "detection_rate": round(float(alarm[is_threat].mean()), 4),
        "false_alarm_rate": round(float(alarm[~is_threat].mean()), 4),
        "ece": round(expected_calibration_error(proba, split.y), 4),
        "confusion_matrix": confusion_matrix(split.y, pred, labels=range(len(CLASSES))).tolist(),
        "per_class_recall": {
            CLASSES[c]: round(float((pred[split.y == c] == c).mean()), 4) for c in range(len(CLASSES))
        },
    }


def candidates() -> dict[str, Pipeline]:
    return {
        "logistic_regression": Pipeline([("scale", StandardScaler()),
                                         ("clf", LogisticRegression(max_iter=3000, C=2.0))]),
        "random_forest": Pipeline([("scale", StandardScaler()),
                                   ("clf", RandomForestClassifier(n_estimators=200, min_samples_leaf=2,
                                                                  n_jobs=-1, random_state=7))]),
        "hist_gradient_boosting": Pipeline([("scale", StandardScaler()),
                                            ("clf", HistGradientBoostingClassifier(max_iter=250,
                                                                                   learning_rate=0.08,
                                                                                   random_state=7))]),
        "mlp_edge": Pipeline([("scale", StandardScaler()),
                              ("clf", MLPClassifier(hidden_layer_sizes=(32, 16), activation="relu",
                                                    alpha=1e-3, learning_rate_init=2e-3, max_iter=600,
                                                    early_stopping=True, n_iter_no_change=25,
                                                    random_state=7))]),
    }


def mlp_footprint(model: Pipeline) -> dict:
    clf: MLPClassifier = model.named_steps["clf"]
    params = sum(w.size for w in clf.coefs_) + sum(b.size for b in clf.intercepts_) + 2 * len(FEATURE_NAMES)
    macs = sum(w.size for w in clf.coefs_)
    return {"parameters": int(params), "flash_bytes_fp32": int(params * 4), "macs_per_inference": int(macs)}


def run(artifacts: Path, n_train: int = 1200, n_eval: int = 400) -> dict:
    artifacts.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    splits = build_splits(n_train, n_eval)
    gen_s = time.perf_counter() - t0

    results: dict[str, dict] = {}
    fitted: dict[str, Pipeline] = {}
    for name, model in candidates().items():
        t1 = time.perf_counter()
        model.fit(splits["train"].X, splits["train"].y)
        fit_s = time.perf_counter() - t1
        val_scores = threat_score(model.predict_proba(splits["val"].X))
        thr = choose_threshold(val_scores, np.isin(splits["val"].y, list(THREAT_CLASSES)))
        results[name] = {
            "threshold": round(thr, 6),
            "fit_seconds": round(fit_s, 2),
            "test": evaluate(model, splits["test"], thr),
            "test_shift": evaluate(model, splits["test_shift"], thr),
        }
        fitted[name] = model
        print(f"{name:24s} test F1={results[name]['test']['macro_f1']:.3f} "
              f"shift F1={results[name]['test_shift']['macro_f1']:.3f} "
              f"DR={results[name]['test']['detection_rate']:.3f} FAR={results[name]['test']['false_alarm_rate']:.3f}")

    edge = fitted["mlp_edge"]
    joblib.dump(edge, artifacts / "edge_mlp.joblib")

    card = {
        "model": "spider-edge-mlp",
        "version": "0.1.0",
        "task": "4-second geophone window classification for intrusion detection at derelict mine shafts",
        "classes": list(CLASSES),
        "threat_classes": [CLASSES[i] for i in sorted(THREAT_CLASSES)],
        "features": list(FEATURE_NAMES),
        "architecture": "StandardScaler → Dense(32, ReLU) → Dense(16, ReLU) → Dense(7, softmax)",
        "footprint": mlp_footprint(edge),
        "alarm_threshold": results["mlp_edge"]["threshold"],
        "operating_point": f"P(threat) threshold chosen on validation for false-alarm rate ≤ {TARGET_FAR:.0%}",
        "training_data": {
            "source": "Physics-informed synthetic geophone signals (sentinel_ml.signals.synth)",
            "windows": {k: int(len(v.y)) for k, v in splits.items()},
            "sample_rate_hz": 500,
            "window_seconds": 4,
            "generation_seconds": round(gen_s, 1),
        },
        "evaluation": results,
        "intended_use": "Edge pre-filter that decides whether a vibration window is worth reporting over the "
                        "mesh. Alerts are always fused with other evidence and reviewed by a human operator.",
        "limitations": [
            "Trained only on synthetic data; field recordings from a Phase-1 pilot are required before "
            "operational reliance.",
            "Underground activity is only observable when surface coupling is sufficient; deep workings "
            "may be invisible to surface geophones.",
            "Animal and vehicle classes are the main false-alarm sources; fusion with PIR and acoustic "
            "channels reduces but does not eliminate them.",
        ],
        "ethical_considerations": "The model classifies ground vibration, not people. It processes no audio "
                                  "content, images or personal identifiers (POPIA s19 data minimisation).",
    }
    (artifacts / "model_card.json").write_text(json.dumps(card, indent=2), encoding="utf-8")
    return {"splits": splits, "models": fitted, "results": results, "card": card}
