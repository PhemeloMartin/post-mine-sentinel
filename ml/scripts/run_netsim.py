"""SilkNet dimensioning experiments → ml/artifacts/netsim_results.json (also copied to the web app).

E1  Scalability: packet delivery & latency vs. number of nodes (SF9, busy night traffic).
E2  Spreading factor trade-off: airtime, sensitivity, range, duty-cycle packet budget.
E3  Resilience: one vs. two anchor gateways when the primary is jammed mid-run.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from sentinel_ml.netsim import MeshConfig, sensitivity_dbm, simulate_mesh, time_on_air_s  # noqa: E402
from sentinel_ml.netsim.lora import max_range_m  # noqa: E402


def main() -> None:
    results: dict = {"e1_scalability": [], "e2_spreading_factor": [], "e3_resilience": []}

    for n in (12, 24, 48, 96):
        r = simulate_mesh(MeshConfig(n_nodes=n, sim_hours=12, event_rate_per_h=4, seed=3))
        results["e1_scalability"].append({"nodes": n, **r.summary()})
        print("E1", n, r.summary())

    for sf in range(7, 13):
        toa = time_on_air_s(24, sf)
        results["e2_spreading_factor"].append({
            "sf": sf,
            "toa_ms": round(toa * 1e3, 1),
            "sensitivity_dbm": round(sensitivity_dbm(sf), 1),
            "range_m_n3": round(max_range_m(sf, exponent=3.0)),
            "packets_per_hour_1pct": round(0.01 * 3600 / toa, 1),
        })

    for gws in (1, 2):
        r = simulate_mesh(MeshConfig(n_gateways=gws, sim_hours=12, jam_gateway_at_h=6, seed=5))
        results["e3_resilience"].append({"gateways": gws, **r.summary()})
        print("E3", gws, r.summary())

    out = ROOT / "ml" / "artifacts" / "netsim_results.json"
    out.write_text(json.dumps(results, indent=2), encoding="utf-8")
    shutil.copyfile(out, ROOT / "apps" / "command-center" / "src" / "data" / "netsim_results.json")
    print("wrote", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
