"""Discrete-event simulation of a SilkNet field (spider nodes → anchor gateways).

Model
-----
* Nodes are scattered around a shaft; 1–2 anchor gateways sit on masts.
* Link success probability uses log-distance path loss with log-normal shadowing:
      PRR(d) = Φ( (P_rx(d) − S) / σ )          (Φ = standard normal CDF)
* Routing: each node picks the parent minimising the expected transmission count to a
  gateway (ETX = 1/PRR summed along the path, Bellman–Ford), i.e. a collection tree like
  RPL / CTP. If a parent's link dies (jamming, tampering) the tree is recomputed.
* MAC: unslotted ALOHA with listen-before-talk off (worst case), capture effect: a frame
  survives an overlap if it is ≥ 6 dB stronger than every interferer at that receiver.
* Duty cycle: each node's airtime is capped per hour (ICASA SRD conditions are checked in
  docs/11-network-design.md; we default to a conservative 1 %).
* Hop-by-hop ACK with up to ``max_retries`` retransmissions and random back-off.
* Energy: SX1262 TX ≈ 45 mA @ 14 dBm, RX ≈ 5 mA, MCU+sensors average ≈ 0.35 mA,
  deep-sleep floor ≈ 15 µA; battery life = capacity / average current.
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field

import numpy as np

from .lora import log_distance_path_loss, sensitivity_dbm, time_on_air_s

CAPTURE_DB = 6.0


@dataclass
class MeshConfig:
    n_nodes: int = 24
    n_gateways: int = 2
    radius_m: float = 250.0
    sf: int = 9
    tx_power_dbm: float = 14.0
    antenna_gain_dbi: float = -8.0          # concealed spiral "web" antenna: small & inefficient
    path_loss_exponent: float = 3.6         # antennas < 1 m above ground in open veld
    excess_loss_db: float = 22.0            # Fresnel-zone obstruction + grass/scrub (same as web twin)
    shadowing_sigma_db: float = 6.0
    gateway_height_gain_db: float = 12.0    # headframe-crown anchor (~30 m) vs. ground nodes
    payload_bytes: int = 32
    heartbeat_s: float = 900.0
    event_rate_per_h: float = 2.0           # detections reported per node per hour (busy night)
    duty_cycle: float = 0.01
    max_retries: int = 3
    sim_hours: float = 24.0
    jam_gateway_at_h: float | None = None   # knock out gateway 0 mid-run
    battery_mah: float = 6000.0
    seed: int = 1


@dataclass
class MeshResult:
    generated: int = 0
    delivered: int = 0
    collisions: int = 0
    duty_cycle_deferrals: int = 0
    latencies_s: list[float] = field(default_factory=list)
    hops: list[int] = field(default_factory=list)
    tx_airtime_s: np.ndarray | None = None
    battery_days: float = 0.0
    parents: list[int] = field(default_factory=list)
    positions: np.ndarray | None = None

    @property
    def pdr(self) -> float:
        return self.delivered / self.generated if self.generated else 0.0

    def summary(self) -> dict:
        lat = np.array(self.latencies_s) if self.latencies_s else np.array([0.0])
        return {
            "packets_generated": self.generated,
            "packet_delivery_ratio": round(self.pdr, 4),
            "latency_p50_s": round(float(np.percentile(lat, 50)), 3),
            "latency_p95_s": round(float(np.percentile(lat, 95)), 3),
            "mean_hops": round(float(np.mean(self.hops)) if self.hops else 0.0, 2),
            "collisions": self.collisions,
            "duty_cycle_deferrals": self.duty_cycle_deferrals,
            "battery_life_days": round(self.battery_days, 1),
        }


def _prr(rx_dbm: float, sens: float, sigma: float) -> float:
    return 0.5 * (1 + math.erf((rx_dbm - sens) / (sigma * math.sqrt(2))))


def simulate_mesh(cfg: MeshConfig) -> MeshResult:
    rng = np.random.default_rng(cfg.seed)
    n, g = cfg.n_nodes, cfg.n_gateways
    # Gateways near the shaft collar; nodes on a jittered ring pattern (fence, headgear, rocks).
    gw_pos = np.array([[cfg.radius_m * 0.15 * math.cos(2 * math.pi * k / g),
                        cfg.radius_m * 0.15 * math.sin(2 * math.pi * k / g)] for k in range(g)])
    ang = rng.uniform(0, 2 * math.pi, n)
    rad = cfg.radius_m * np.sqrt(rng.uniform(0.05, 1.0, n))
    node_pos = np.column_stack([rad * np.cos(ang), rad * np.sin(ang)])
    pos = np.vstack([gw_pos, node_pos])          # 0..g-1 gateways, g.. nodes
    total = g + n
    sens = sensitivity_dbm(cfg.sf)
    toa = time_on_air_s(cfg.payload_bytes, cfg.sf)

    shadow = rng.normal(0, cfg.shadowing_sigma_db, (total, total))
    shadow = (shadow + shadow.T) / 2              # reciprocal links
    rx = np.full((total, total), -200.0)
    for i in range(total):
        for j in range(total):
            if i != j:
                d = float(np.hypot(*(pos[i] - pos[j])))
                gain = cfg.gateway_height_gain_db if (i < g or j < g) else 0.0
                rx[i, j] = (cfg.tx_power_dbm + 2 * cfg.antenna_gain_dbi + gain - cfg.excess_loss_db
                            - log_distance_path_loss(d, cfg.path_loss_exponent) - shadow[i, j])
    alive_gw = [True] * g

    def build_tree() -> tuple[list[int], list[float]]:
        etx = [math.inf] * total
        parent = [-1] * total
        for k in range(g):
            if alive_gw[k]:
                etx[k] = 0.0
        for _ in range(total):
            changed = False
            for i in range(g, total):
                for j in range(total):
                    if i == j or etx[j] == math.inf or (j < g and not alive_gw[j]):
                        continue
                    p = _prr(rx[i, j], sens, cfg.shadowing_sigma_db / 2)
                    if p < 0.1:
                        continue
                    cand = etx[j] + 1 / p
                    if cand < etx[i] - 1e-9:
                        etx[i], parent[i], changed = cand, j, True
            if not changed:
                break
        return parent, etx

    parent, _ = build_tree()
    res = MeshResult(tx_airtime_s=np.zeros(total), positions=pos, parents=parent[:])
    horizon = cfg.sim_hours * 3600
    events: list[tuple[float, int, str, dict]] = []
    seq = 0

    def push(t: float, kind: str, data: dict) -> None:
        nonlocal seq
        heapq.heappush(events, (t, seq, kind, data))
        seq += 1

    for i in range(g, total):
        push(rng.uniform(0, cfg.heartbeat_s), "gen", {"node": i, "kind": "hb"})
        if cfg.event_rate_per_h > 0:
            push(rng.exponential(3600 / cfg.event_rate_per_h), "gen", {"node": i, "kind": "ev"})
    if cfg.jam_gateway_at_h is not None:
        push(cfg.jam_gateway_at_h * 3600, "jam", {})

    on_air: list[tuple[float, float, int, int]] = []   # (start, end, tx, rx)
    budget_window = [0.0] * total                        # airtime used in current hour
    window_start = [0.0] * total

    while events:
        t, _, kind, data = heapq.heappop(events)
        if t > horizon:
            break
        if kind == "jam":
            alive_gw[0] = False
            parent, _ = build_tree()
            continue
        if kind == "gen":
            node = data["node"]
            res.generated += 1
            nxt = cfg.heartbeat_s if data["kind"] == "hb" else rng.exponential(3600 / cfg.event_rate_per_h)
            push(t + nxt, "gen", data)
            push(t, "tx", {"node": node, "born": t, "hops": 0, "tries": 0})
            continue
        if kind == "tx":
            node = data["node"]
            par = parent[node]
            if par < 0:
                continue                                  # orphaned: dropped (store-and-forward is future work)
            if t - window_start[node] >= 3600:
                window_start[node], budget_window[node] = t, 0.0
            if budget_window[node] + toa > cfg.duty_cycle * 3600:
                res.duty_cycle_deferrals += 1
                push(window_start[node] + 3600 + rng.uniform(0, 5), "tx", data)
                continue
            budget_window[node] += toa
            res.tx_airtime_s[node] += toa
            start, end = t, t + toa
            on_air[:] = [f for f in on_air if f[1] > start]
            interferers = [f for f in on_air if f[0] < end and f[2] != node]
            on_air.append((start, end, node, par))
            signal = rx[node, par]
            captured = all(signal - rx[f[2], par] >= CAPTURE_DB for f in interferers)
            if interferers and not captured:
                res.collisions += 1
            ok = captured and rng.random() < _prr(signal, sens, cfg.shadowing_sigma_db / 2)
            if ok:
                if par < g:
                    if alive_gw[par]:
                        res.delivered += 1
                        res.latencies_s.append(end - data["born"])
                        res.hops.append(data["hops"] + 1)
                else:
                    push(end + rng.uniform(0.05, 0.3), "tx",
                         {"node": par, "born": data["born"], "hops": data["hops"] + 1, "tries": 0})
            elif data["tries"] < cfg.max_retries:
                backoff = rng.uniform(1, 2 ** (data["tries"] + 2)) * toa
                push(end + backoff, "tx", {**data, "tries": data["tries"] + 1})

    # Energy model (per node average current over the run).
    i_tx_ma, i_rx_ma, i_base_ma = 45.0, 5.0, 0.35
    rx_listen_fraction = 0.02                           # scheduled receive windows for forwarding
    tx_frac = res.tx_airtime_s[g:] / horizon
    avg_ma = i_base_ma + i_tx_ma * tx_frac + i_rx_ma * rx_listen_fraction
    res.battery_days = float(cfg.battery_mah / np.max(avg_ma) / 24)
    res.parents = parent[:]
    return res
