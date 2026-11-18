"""Password hashing (Argon2id), JWT access tokens and service-to-service authentication."""

from __future__ import annotations

import hmac
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .config import Settings
from .errors import Unauthorized

# OWASP 2024 guidance for Argon2id: m=19 MiB, t=2, p=1 (minimum); we use 64 MiB / t=3.
_hasher = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=1)
# Constant-time dummy verification for unknown usernames (prevents user enumeration by timing).
_DUMMY_HASH = _hasher.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def issue_access_token(settings: Settings, *, subject: str, role: str, org: str | None) -> tuple[str, int]:
    now = datetime.now(UTC)
    exp = now + timedelta(minutes=settings.access_token_minutes)
    claims = {
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "sub": subject,
        "role": role,
        "org": org,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(claims, settings.jwt_secret.get_secret_value(), algorithm="HS256")
    return token, settings.access_token_minutes * 60


def decode_access_token(settings: Settings, token: str) -> dict:
    try:
        return jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],            # pin the algorithm: never accept "none" or RS/HS confusion
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "role"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise Unauthorized("Session expired. Please sign in again.") from exc
    except jwt.PyJWTError as exc:
        raise Unauthorized("Invalid access token.") from exc


def verify_service_token(settings: Settings, presented: str | None) -> None:
    """Shared-secret check for the Go ingest service (mTLS replaces this in production)."""
    expected = settings.ingest_token.get_secret_value()
    if not presented or not hmac.compare_digest(presented, expected):
        raise Unauthorized("Invalid service credentials.")
