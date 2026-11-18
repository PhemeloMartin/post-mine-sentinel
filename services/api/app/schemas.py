"""Pydantic v2 request/response contracts (the OpenAPI document is generated from these)."""

from __future__ import annotations

from datetime import datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - OAuth2 token type, not a secret
    expires_in: int
    role: str
    display_name: str


class Me(BaseModel):
    username: str
    display_name: str
    role: str
    permissions: list[str]


class MineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    commodity: str
    province: str
    locality: str
    lat: float
    lon: float
    precision_m: int
    location_generalised: bool = False
    status: str
    opened: int | None
    closed: int | None
    method: str
    max_depth_m: float | None
    production: dict | None
    residual: dict | None
    rai: float | None
    rai_band: str | None
    rai_contributions: dict | None = None
    illegal_reported: bool | None = None
    notes: str | None = None


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class Vote(BaseModel):
    """One node's report for a window, as decoded and authenticated by the ingest service."""

    node: str = Field(pattern=r"^S\d{2}$")
    kind: Literal["seismic", "benign", "pir", "tamper"]
    cls: str = Field(max_length=16)
    p_threat: float = Field(ge=0, le=1)
    snr_db: float = Field(ge=-60, le=120)
    arrival_offset_ms: float | None = Field(default=None, ge=0, le=60_000)
    frame_counter: int = Field(ge=0, lt=2**32)
    gateway: str = Field(max_length=16)


class WindowBatch(BaseModel):
    mine_id: str
    window_start: datetime
    votes: list[Vote] = Field(min_length=1, max_length=256)


class FusionResult(BaseModel):
    site: str
    posterior: float
    log_odds: float
    window_llr: float
    accepted_votes: int
    duplicate_votes: int
    alert_ref: str | None


class AlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    ref: str
    status: str
    level: str
    posterior: float
    reason: str
    tamper: bool
    raised_at: datetime
    acknowledged_at: datetime | None
    acknowledged_by: str | None
    dispatched_at: datetime | None
    resolved_at: datetime | None
    case_ref: str | None
    signature: str
    mine_id: str


class PlanRequest(BaseModel):
    depot_lat: float = Field(ge=-35.5, le=-21.5)
    depot_lon: float = Field(ge=16, le=33.5)
    budget_hours: float = Field(gt=0, le=16)
    radius_km: float = Field(default=160, gt=0, le=600)
    solver: Literal["heuristic", "exact", "qaoa"] = "heuristic"
    max_sites: int = Field(default=40, ge=1, le=300)


class PlanOut(BaseModel):
    solver: str
    route: list[str]
    value: float
    duration_hours: float
    candidates: int
    notes: str | None = None


class AuditVerify(BaseModel):
    ok: bool
    first_bad_seq: int | None
    entries: int
