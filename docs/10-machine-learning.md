# 10. Machine learning

Four models, each chosen for its context: an **edge classifier** (TinyML), **site risk** (interpretable logistic), **evidence fusion** (Bayesian) and **satellite change** (robust statistics + CUSUM).

## 10.1 Edge intrusion classifier

| | |
|---|---|
| Task | Classify a 4 s, 500 Hz geophone window: background, footsteps, digging, machinery, vehicle, animal, blast |
| Features | 21 deterministic features (time-domain, spectral, envelope rhythm, impulses), identical in Python and C++ |
| Model | StandardScaler → Dense(32, ReLU) → Dense(16, ReLU) → softmax(7) |
| Footprint | **1,393 parameters · 5.6 KB flash · 1,296 MAC per inference** |
| Training data | **Physics-informed synthetic** windows (8,400 train / 2,100 validation / 2,800 test / 2,800 shifted test). See [ADR-0009](adr/0009-synthetic-bootstrap-data.md) |
| Selection | Compared against logistic regression, random forest and histogram gradient boosting |

### Results (`ml/artifacts/model_card.json`)

| Model | Test macro-F1 | Shifted-soil macro-F1 | Detection @ θ | False alarms @ θ |
|---|---|---|---|---|
| Logistic regression | 0.912 | 0.729 | 93.1 % | 2.3 % |
| Random forest | **0.936** | **0.754** | 96.0 % | 2.2 % |
| Hist. gradient boosting | 0.934 | 0.754 | 95.8 % | 2.1 % |
| **MLP (deployed)** | 0.929 | 0.745 | 95.4 % | 2.2 % |

The deployed MLP reaches a threat AUC of **0.992** and ECE of **0.016** (well calibrated), with blast recall of 1.00. It is within 0.7 F1 points of the best model at a fraction of the memory: a random forest of 200 trees cannot fit in a few KB.

### Honest findings

* **Domain shift is the main risk.** On soil parameters never seen in training (harder ground, a noisier site), macro-F1 drops to 0.745 and the false-alarm rate rises to **11.8 %**. In the site twin (40 seeds per scenario), the "uncalibrated" profile misses 10/40 blasts, slows median detection from ≈ 47 s to ≈ 69 s and produced 1 false alarm in 40 quiet nights, against 0/80 benign runs when calibrated. **Mitigation:** a 48-hour **site-commissioning period** (background statistics, threshold re-tuning), then fine-tuning on field recordings from the Phase-1 pilot.
* **Physics finding:** the first version under-modelled blasts by applying soil attenuation to body waves through rock. Correcting the physics raised blast recall from 0.71 to 1.00.
* Animals are the hardest benign class (recall 0.77): 19 % of animal windows look like background and 3.5 % look like threats. Fusion with benign votes and PIR corroboration absorbs this (0 false alarms in livestock runs).

### Firmware parity

`ml/sentinel_ml/edge/export.py` writes `model_weights.h` and **golden vectors** (raw windows → expected features → expected probabilities). The firmware unit tests assert that C++ matches Python, which prevents silent train/serve skew, a classic MLOps failure.

## 10.2 Site risk (RAI)

Interpretable logistic model (formula in [09 §9.1](09-mathematical-models.md#91-site-risk-residual-attraction-index-mlsentinel_mlriskraipy)). The labels (public incident reports) are **positive-unlabelled**: silence does not mean safety. History $H$ is excluded during calibration to avoid target leakage.

| | Expert weights | Learned (L2 logistic) |
|---|---|---|
| Commodity | 2.0 | 1.58 |
| Residual value | 2.0 | 1.54 |
| Access | 3.0 | 1.25 |
| Pressure | 1.5 | **0.09** |
| AUC (static factors) | **0.80** | 0.76 (leave-one-out) |

All learned weights share the expert signs. The near-zero pressure weight is an interesting finding: reported incidents correlate with *where journalists and police already look*, not purely with population. The expert prior stays operational until inspection outcomes provide true negatives.

## 10.3 Evidence fusion

Bayesian log-odds fusion with per-window Chair–Varshney votes, a √n correlation discount, a negative-evidence floor and k-of-k persistence ([09 §9.5](09-mathematical-models.md#95-evidence-fusion-mlsentinel_mlfusionbayespy-servicesapiappservicesfusionpy-simenginets)). This was developed iteratively, driven by test failures:

1. Per-report updates → false alarms from correlated cattle votes.
2. Adding negative evidence fixed that, but unbounded negative evidence *masked* the problem and could suppress real intrusions.
3. A 40-seed benchmark then exposed a rarer mode: a jackal at the collar is occasionally misclassified as footsteps **and** trips the PIR, so the two pieces of evidence are correlated, not independent (1/40 quiet nights). Fix: a **pet-immune PIR** specification and PIR corroboration of *gait* votes only.
4. The final design gives **160/160 detections and 0/80 false-alarm runs** (calibrated), with median latency of 44–47 s (p90 ≤ 64 s).

## 10.4 Satellite change (ShaftWatch)

A robust seasonal z-score against the site's own history (no look-ahead) feeds a CUSUM. Tests confirm that an injected disturbance is detected within 0–8 months of onset with no false alarm on a quiet series. Live data comes from the Earth Engine job (`gee_pipeline.py`).

## 10.5 Responsible AI and MLOps

* **Model card** is versioned with the code; **golden vectors** gate firmware releases.
* Data lineage: generator seeds and parameters are in code, so every number in this document is reproducible (`python ml/scripts/train_edge.py`).
* No personal data in any training set. The classifiers see ground vibration only.
* **Roadmap:** Phase-1 field recordings → semi-supervised labelling with analysts in the loop → per-soil-type models → INT8 quantisation for the STM32WL target → drift monitoring (feature distributions in heartbeats).
