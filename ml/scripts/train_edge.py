"""Train the edge classifier, write the model card and export firmware headers.

    python ml/scripts/train_edge.py            # full run (~1 min)
    python ml/scripts/train_edge.py --quick    # smoke run for CI
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from sentinel_ml.edge.export import export_all  # noqa: E402
from sentinel_ml.edge.train import run  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    artifacts = ROOT / "ml" / "artifacts"
    out = run(artifacts, n_train=150 if args.quick else 1200, n_eval=80 if args.quick else 400)
    test = out["splits"]["test"]
    export_all(out["models"]["mlp_edge"], out["card"]["alarm_threshold"], test.raw, test.y, ROOT, artifacts)
    # The web command centre reads the model card to drive its simulated classifier.
    web = ROOT / "apps" / "command-center" / "src" / "data"
    web.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(artifacts / "model_card.json", web / "model_card.json")
    print("artifacts written to", artifacts.relative_to(ROOT))


if __name__ == "__main__":
    main()
