"""Twelve-factor configuration: every setting comes from the environment (or .env in dev)."""

from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SENTINEL_", env_file=".env", extra="ignore")

    env: str = "dev"                                   # dev | test | prod
    database_url: str = "sqlite:///./sentinel-dev.sqlite3"
    # Secrets: required in prod (validated in main.create_app); random per-process in dev.
    jwt_secret: SecretStr = Field(default_factory=lambda: SecretStr(secrets.token_urlsafe(48)))
    jwt_issuer: str = "post-mine-sentinel"
    jwt_audience: str = "sentinel-console"
    access_token_minutes: int = 15
    ingest_token: SecretStr = Field(default_factory=lambda: SecretStr(secrets.token_urlsafe(32)))
    evidence_signing_key_hex: SecretStr | None = None  # Ed25519 private key (32 bytes hex) — Key Vault in prod
    case_service_url: str = "http://case-service:8080"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:4173"]
    seed_demo: bool = True
    demo_password: SecretStr | None = None
    data_dir: Path = REPO_ROOT / "data"
    login_max_failures: int = 5
    login_lockout_minutes: int = 15

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()
