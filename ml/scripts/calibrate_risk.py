"""Fit RAI weights to weak incident labels and write ml/artifacts/risk_calibration.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from sentinel_ml.risk.calibrate import calibrate  # noqa: E402

if __name__ == "__main__":
    report = calibrate(ROOT / "data" / "mines" / "sa_mines.json")
    out = ROOT / "ml" / "artifacts" / "risk_calibration.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
