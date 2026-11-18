"""LoRa physical-layer maths used to dimension the SilkNet mesh.

Time on air (Semtech AN1200.13):
    T_sym      = 2^SF / BW
    T_preamble = (n_preamble + 4.25) · T_sym
    n_payload  = 8 + max( ceil( (8·PL − 4·SF + 28 + 16·CRC − 20·IH) / (4·(SF − 2·DE)) ) · (CR + 4), 0 )
    ToA        = T_preamble + n_payload · T_sym
  with DE (low-data-rate optimise) = 1 when T_sym > 16 ms.

Receiver sensitivity:
    S [dBm] = −174 + 10·log10(BW) + NF + SNR_min(SF)

Path loss:
    FSPL(d, f)   = 20·log10(d) + 20·log10(f) − 147.55             (d in m, f in Hz)
    PL(d)        = PL(d₀) + 10·n·log10(d/d₀) + X_σ                 (log-distance + log-normal shadowing)
  Ground-hugging nodes (antennas < 0.5 m, as on a fence post or headgear leg) see path-loss
  exponents n ≈ 2.8–3.5 in open veld, which is why the anchor gateway is mounted high.

Link margin:
    M = P_tx + G_tx + G_rx − PL(d) − S
"""

from __future__ import annotations

import math
from dataclasses import dataclass

#: Demodulator SNR floor per spreading factor (SX126x datasheet).
SNR_MIN_DB = {7: -7.5, 8: -10.0, 9: -12.5, 10: -15.0, 11: -17.5, 12: -20.0}


def time_on_air_s(payload_bytes: int, sf: int = 9, bw_hz: float = 125e3, cr: int = 1,
                  preamble: int = 8, explicit_header: bool = True, crc: bool = True,
                  low_dr_optimize: bool | None = None) -> float:
    """Packet airtime in seconds. ``cr`` is the coding-rate index (1 → 4/5 … 4 → 4/8)."""
    t_sym = (2 ** sf) / bw_hz
    de = (t_sym > 0.016) if low_dr_optimize is None else low_dr_optimize
    ih = 0 if explicit_header else 1
    num = 8 * payload_bytes - 4 * sf + 28 + 16 * int(crc) - 20 * ih
    den = 4 * (sf - 2 * int(de))
    n_payload = 8 + max(math.ceil(num / den) * (cr + 4), 0)
    return (preamble + 4.25) * t_sym + n_payload * t_sym


def sensitivity_dbm(sf: int, bw_hz: float = 125e3, noise_figure_db: float = 6.0) -> float:
    return -174 + 10 * math.log10(bw_hz) + noise_figure_db + SNR_MIN_DB[sf]


def fspl_db(distance_m: float, freq_hz: float = 868e6) -> float:
    return 20 * math.log10(max(distance_m, 1e-3)) + 20 * math.log10(freq_hz) - 147.55


def log_distance_path_loss(distance_m: float, exponent: float = 3.0, d0_m: float = 1.0,
                           freq_hz: float = 868e6, shadowing_db: float = 0.0) -> float:
    return fspl_db(d0_m, freq_hz) + 10 * exponent * math.log10(max(distance_m, d0_m) / d0_m) + shadowing_db


@dataclass(frozen=True)
class LinkBudget:
    distance_m: float
    path_loss_db: float
    rx_power_dbm: float
    sensitivity_dbm: float
    margin_db: float
    time_on_air_ms: float
    max_packets_per_hour: float

    @property
    def closes(self) -> bool:
        return self.margin_db >= 0


def link_budget(distance_m: float, sf: int = 9, tx_power_dbm: float = 14.0, antenna_gain_dbi: float = 2.0,
                exponent: float = 3.0, payload_bytes: int = 32, bw_hz: float = 125e3,
                duty_cycle: float = 0.01) -> LinkBudget:
    pl = log_distance_path_loss(distance_m, exponent)
    rx = tx_power_dbm + 2 * antenna_gain_dbi - pl
    sens = sensitivity_dbm(sf, bw_hz)
    toa = time_on_air_s(payload_bytes, sf, bw_hz)
    return LinkBudget(distance_m, round(pl, 2), round(rx, 2), round(sens, 2), round(rx - sens, 2),
                      round(toa * 1e3, 3), round(duty_cycle * 3600 / toa, 1))


def max_range_m(sf: int = 9, tx_power_dbm: float = 14.0, antenna_gain_dbi: float = 2.0,
                exponent: float = 3.0, fade_margin_db: float = 10.0) -> float:
    """Distance where the margin equals the required fade margin (closed form)."""
    budget = tx_power_dbm + 2 * antenna_gain_dbi - sensitivity_dbm(sf) - fade_margin_db - fspl_db(1.0)
    return 10 ** (budget / (10 * exponent))
