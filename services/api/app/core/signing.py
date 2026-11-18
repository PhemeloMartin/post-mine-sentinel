"""Ed25519 signatures over alert/evidence payloads (non-repudiation, ECTA s15, CPA s212).

The private key lives in Azure Key Vault (managed HSM) in production and is injected as an
environment secret; in development an ephemeral key is generated per process.
"""

from __future__ import annotations

import json
from functools import lru_cache

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from .config import get_settings


@lru_cache
def _private_key() -> Ed25519PrivateKey:
    secret = get_settings().evidence_signing_key_hex
    if secret is not None:
        return Ed25519PrivateKey.from_private_bytes(bytes.fromhex(secret.get_secret_value()))
    return Ed25519PrivateKey.generate()


def public_key_hex() -> str:
    raw = _private_key().public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return raw.hex()


def _canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


def sign(payload: dict) -> str:
    return _private_key().sign(_canonical(payload)).hex()


def verify(payload: dict, signature_hex: str, public_hex: str | None = None) -> bool:
    try:
        pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_hex or public_key_hex()))
        pub.verify(bytes.fromhex(signature_hex), _canonical(payload))
        return True
    except (InvalidSignature, ValueError):
        return False
