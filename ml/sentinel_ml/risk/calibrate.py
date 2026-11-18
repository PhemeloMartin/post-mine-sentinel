"""Calibrate the RAI weights against weak incident labels.

Label y = 1 when illegal mining has been publicly reported at or next to the site.
These are *positive-unlabelled* (PU) data: silence does not mean absence, it often means
nobody looked. We therefore:

* fit an L2-regularised logistic regression on the static factors only (history H is
  excluded because it *is* the label — including it would be target leakage);
* evaluate with leave-one-out cross-validation (n ≈ 120 is small);
* report AUC, Brier score and the learned-vs-expert weight drift, and keep the expert
  weights as the operational prior unless the data clearly disagree.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import LeaveOneOut, cross_val_predict

from .rai import EXPERT_WEIGHTS, sigmoid

STATIC = ("commodity", "residual", "access", "pressure")


def calibrate(register_path: Path) -> dict:
    mines = json.loads(register_path.read_text(encoding="utf-8"))["mines"]
    X = np.array([[m["risk"]["factors"][k] for k in STATIC] for m in mines])
    y = np.array([1 if m["illegalActivity"]["reported"] else 0 for m in mines])

    model = LogisticRegression(C=1.0, max_iter=2000)
    loo = cross_val_predict(model, X, y, cv=LeaveOneOut(), method="predict_proba")[:, 1]
    model.fit(X, y)

    expert_z = EXPERT_WEIGHTS["bias"] + X @ np.array([EXPERT_WEIGHTS[k] for k in STATIC])
    expert_p = np.array([sigmoid(z) for z in expert_z])

    return {
        "n_sites": int(len(y)),
        "n_positive": int(y.sum()),
        "learned_weights": {"bias": round(float(model.intercept_[0]), 3),
                            **{k: round(float(w), 3) for k, w in zip(STATIC, model.coef_[0], strict=True)}},
        "expert_weights": {k: EXPERT_WEIGHTS[k] for k in ("bias", *STATIC)},
        "loo_auc_learned": round(float(roc_auc_score(y, loo)), 4),
        "auc_expert_static": round(float(roc_auc_score(y, expert_p)), 4),
        "brier_learned_loo": round(float(brier_score_loss(y, loo)), 4),
        "note": "Weak positive-unlabelled labels from public reporting; expert weights remain the "
                "operational prior. Re-run when inspection outcomes (true negatives) are available.",
    }
