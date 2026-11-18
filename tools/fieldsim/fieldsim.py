"""Field simulator: plays the anchor gateways of one site for end-to-end demos.

Publishes real, AES-128-CCM encrypted SilkNet frames over MQTT exactly as anchors would, so the
whole chain runs: fieldsim → Mosquitto → Go ingest (auth, replay, windowing) → FastAPI fusion →
alert → outbox → ASP.NET case service.

    python tools/fieldsim/fieldsim.py --broker localhost:1883 --scenario incursion
"""

from __future__ import annotations

import argparse
import base64
import json
import random
import sys
import time
from pathlib import Path

import paho.mqtt.client as mqtt

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "protocol"))

from silknet import TYPES, Detection, derive_node_key, encode  # noqa: E402

SCENARIOS = {
    # (seconds from start, nodes, frame type, class id, p_threat)
    "incursion": [(t, nodes, "DETECTION", 1, 0.93) for t, nodes in
                  [(8, (21,)), (12, (21, 15)), (16, (15, 10, 21)), (20, (10, 9, 15)), (24, (10, 9, 3)), (28, (3, 4, 9))]],
    "quiet": [(t, (6, 7), "BENIGN", 5, 0.08) for t in range(4, 40, 4)],
    "tamper": [(6, (21,), "DETECTION", 1, 0.9), (10, (21,), "TAMPER", 0, 1.0)],
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--broker", default="localhost:1883")
    ap.add_argument("--username", default="fieldsim")
    ap.add_argument("--password", default="")
    ap.add_argument("--mine", default="ZA-NW-002")
    ap.add_argument("--site-id", type=int, default=7)
    ap.add_argument("--site-key", default="2b7e151628aed2a6abf7158809cf4f3c")
    ap.add_argument("--scenario", choices=sorted(SCENARIOS), default="incursion")
    args = ap.parse_args()

    host, port = args.broker.split(":")
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"fieldsim-{random.randint(0, 9999)}")
    if args.password:
        client.username_pw_set(args.username, args.password)
    client.connect(host, int(port), keepalive=30)
    client.loop_start()

    site_key = bytes.fromhex(args.site_key)
    counters: dict[int, int] = {}
    t0 = time.time()
    window0 = int(t0) - int(t0) % 4
    for at, nodes, ftype, cls, p in SCENARIOS[args.scenario]:
        time.sleep(max(0.0, t0 + at - time.time()))
        window = window0 + (at // 4) * 4
        for node in nodes:
            counters[node] = counters.get(node, int(time.time()) & 0xFFFF) + 1
            det = Detection(window, cls, p, random.uniform(14, 26), random.randint(100, 3800), random.randint(70, 95),
                            1 if ftype == "TAMPER" else 0)
            frame = encode(TYPES[ftype], 0x01, args.site_id, node, counters[node], det.pack(),
                           derive_node_key(site_key, args.site_id, node))
            for gw in ("A1", "A2") if random.random() < 0.4 else ("A1",):  # some frames heard twice
                msg = {"gw": gw, "rssi": round(random.uniform(-118, -92), 1), "snr": round(random.uniform(2, 9), 1),
                       "frame": base64.b64encode(frame).decode()}
                client.publish(f"silknet/{args.mine}/up", json.dumps(msg), qos=1)
        print(f"t+{at:>3}s window {window} {ftype:<9} nodes {nodes}")
    time.sleep(4)
    client.loop_stop()
    client.disconnect()


if __name__ == "__main__":
    main()
