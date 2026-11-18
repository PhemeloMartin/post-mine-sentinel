"""Reference Python implementation of SilkNet v1 (see SILKNET.md). Used for test vectors and the field simulator."""

from __future__ import annotations

import hashlib
import hmac
import struct
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESCCM

VERSION = 1
TYPES = {"HEARTBEAT": 0, "DETECTION": 1, "PIR": 2, "TAMPER": 3, "BENIGN": 4, "ACK": 5, "BEACON": 6}
HEADER_LEN = 10
MIC_LEN = 8
PAYLOAD_LEN = 14
CLASSES = ("background", "footsteps", "digging", "machinery", "vehicle", "animal", "blast")


def derive_node_key(site_key: bytes, site_id: int, node_id: int) -> bytes:
    msg = b"silknet-v1" + struct.pack(">HH", site_id, node_id)
    return hmac.new(site_key, msg, hashlib.sha256).digest()[:16]


def nonce(site_id: int, node_id: int, counter: int, direction: int = 0) -> bytes:
    return struct.pack(">HHIB", site_id, node_id, counter, direction) + b"\x00" * 4


@dataclass(frozen=True)
class Detection:
    window_start: int
    class_id: int
    p_threat: float
    snr_db: float
    arrival_ms: int
    battery_pct: int
    status: int = 0

    def pack(self) -> bytes:
        return struct.pack(
            ">IBBbHBB3x",
            self.window_start,
            self.class_id,
            round(max(0.0, min(1.0, self.p_threat)) * 255),
            int(max(-60, min(120, round(self.snr_db)))),
            max(0, min(4000, self.arrival_ms)),
            max(0, min(100, self.battery_pct)),
            self.status,
        )

    @staticmethod
    def unpack(b: bytes) -> Detection:
        ws, cls, p, snr, arr, bat, st = struct.unpack(">IBBbHBB3x", b)
        return Detection(ws, cls, p / 255, snr, arr, bat, st)


def encode(frame_type: int, flags: int, site_id: int, node_id: int, counter: int, payload: bytes, node_key: bytes) -> bytes:
    header = struct.pack(">BBHHI", (VERSION << 4) | frame_type, flags, site_id, node_id, counter)
    aad = header[0:1] + header[2:]
    ct = AESCCM(node_key, tag_length=MIC_LEN).encrypt(nonce(site_id, node_id, counter), payload, aad)
    return header + ct


def decode(frame: bytes, node_key_for: callable) -> tuple[dict, bytes]:
    if len(frame) < HEADER_LEN + MIC_LEN:
        raise ValueError("frame too short")
    vt, flags, site_id, node_id, counter = struct.unpack(">BBHHI", frame[:HEADER_LEN])
    if vt >> 4 != VERSION:
        raise ValueError("unsupported version")
    aad = frame[0:1] + frame[2:HEADER_LEN]
    key = node_key_for(site_id, node_id)
    payload = AESCCM(key, tag_length=MIC_LEN).decrypt(nonce(site_id, node_id, counter), frame[HEADER_LEN:], aad)
    hdr = {"type": vt & 0x0F, "flags": flags, "hops": (flags >> 2) & 0x07, "site_id": site_id, "node_id": node_id,
           "counter": counter}
    return hdr, payload
