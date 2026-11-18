"""Relational model (3NF core + time-series facts). See docs/05-database-design.md for the ERD.

Portable column types are used so the same models run on SQLite in tests. Production
PostgreSQL adds (via infra/db/init/010_postgis_timescale.sql):
  * generated ``geography(Point,4326)`` columns + GiST indexes on mines/nodes,
  * TimescaleDB hypertables on ``detections`` and ``node_telemetry`` with retention policies,
  * row-level security by organisation, and an UPDATE/DELETE-blocking trigger on ``audit_log``.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .session import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class Organisation(Base):
    __tablename__ = "organisations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    kind: Mapped[str] = mapped_column(String(32))  # government | municipality | mining_company | saps | operator


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role in ('admin','analyst','field_officer','auditor','community_liaison')"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32))
    organisation_id: Mapped[int | None] = mapped_column(ForeignKey("organisations.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    organisation: Mapped[Organisation | None] = relationship()


class Mine(Base):
    __tablename__ = "mines"
    __table_args__ = (
        CheckConstraint("lat between -35.5 and -21.5 and lon between 16 and 33.5", name="ck_mine_in_sa"),
        Index("ix_mines_rai", "rai"),
    )
    id: Mapped[str] = mapped_column(String(16), primary_key=True)          # ZA-NW-002
    name: Mapped[str] = mapped_column(String(160))
    commodity: Mapped[str] = mapped_column(String(24), index=True)
    province: Mapped[str] = mapped_column(String(4), index=True)
    locality: Mapped[str] = mapped_column(String(160))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    precision_m: Mapped[int] = mapped_column(Integer)
    field: Mapped[str] = mapped_column(String(120))
    method: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(24), index=True)
    opened: Mapped[int | None] = mapped_column(Integer)
    closed: Mapped[int | None] = mapped_column(Integer)
    max_depth_m: Mapped[float | None] = mapped_column(Float)
    production: Mapped[dict | None] = mapped_column(JSON)
    residual: Mapped[dict | None] = mapped_column(JSON)
    illegal_reported: Mapped[bool] = mapped_column(Boolean, default=False)
    illegal_last_year: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    rai: Mapped[float] = mapped_column(Float)
    rai_band: Mapped[str] = mapped_column(String(12))
    rai_factors: Mapped[dict] = mapped_column(JSON)
    rai_contributions: Mapped[dict] = mapped_column(JSON)


class Site(Base):
    """A monitored mine: one S.P.I.D.E.R. field + anchors reporting to a SOC hub."""

    __tablename__ = "sites"
    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[str] = mapped_column(ForeignKey("mines.id"), unique=True)
    hub: Mapped[str] = mapped_column(String(16))
    phase: Mapped[int] = mapped_column(Integer)
    backhaul: Mapped[str] = mapped_column(String(16))
    prior: Mapped[float] = mapped_column(Float)
    mine: Mapped[Mine] = relationship()
    nodes: Mapped[list[SensorNode]] = relationship(back_populates="site", cascade="all, delete-orphan")


class SensorNode(Base):
    __tablename__ = "sensor_nodes"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)          # ZA-NW-002:S01
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"), index=True)
    kind: Mapped[str] = mapped_column(String(12), default="spider")        # spider | anchor
    mount: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="ok")          # ok | tampered | offline | decommissioned
    battery_pct: Mapped[float] = mapped_column(Float, default=100.0)
    firmware: Mapped[str] = mapped_column(String(24), default="0.1.0")
    frame_counter: Mapped[int] = mapped_column(Integer, default=0)         # last accepted (replay protection)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    site: Mapped[Site] = relationship(back_populates="nodes")


class Detection(Base):
    """One node vote for one 4-second window (Timescale hypertable on window_start in prod)."""

    __tablename__ = "detections"
    __table_args__ = (
        UniqueConstraint("node_id", "frame_counter", name="uq_detection_frame"),  # idempotent ingest
        Index("ix_detections_site_window", "site_id", "window_start"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"))
    node_id: Mapped[str] = mapped_column(ForeignKey("sensor_nodes.id"))
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    kind: Mapped[str] = mapped_column(String(12))        # seismic | benign | pir | tamper
    cls: Mapped[str] = mapped_column(String(16))
    p_threat: Mapped[float] = mapped_column(Float)
    snr_db: Mapped[float] = mapped_column(Float)
    arrival_offset_ms: Mapped[float | None] = mapped_column(Float)
    frame_counter: Mapped[int] = mapped_column(Integer)
    gateway_id: Mapped[str] = mapped_column(String(16))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SiteBelief(Base):
    """Persisted fusion state so any API replica can continue a site's evidence stream."""

    __tablename__ = "site_beliefs"
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"), primary_key=True)
    log_odds: Mapped[float] = mapped_column(Float)
    consecutive_high: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (CheckConstraint("status in ('raised','acknowledged','dispatched','resolved')"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    ref: Mapped[str] = mapped_column(String(24), unique=True)               # ALR-2026-000123
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="raised")
    level: Mapped[str] = mapped_column(String(12))
    posterior: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(String(255))
    tamper: Mapped[bool] = mapped_column(Boolean, default=False)
    raised_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_by: Mapped[str | None] = mapped_column(String(64))
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    case_ref: Mapped[str | None] = mapped_column(String(32))
    signed_payload: Mapped[dict] = mapped_column(JSON)                      # exact bytes-to-be-signed (canonical JSON)
    signature: Mapped[str] = mapped_column(String(128))                     # Ed25519 over signed_payload
    site: Mapped[Site] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_log"
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    at: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(32))
    action: Mapped[str] = mapped_column(String(64))
    resource: Mapped[str] = mapped_column(String(64))
    outcome: Mapped[str] = mapped_column(String(8))
    ip: Mapped[str | None] = mapped_column(String(64))
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64), unique=True)


class OutboxEvent(Base):
    """Transactional outbox: events are committed with the business change, then relayed
    to the case service with retries; poison messages move to 'dead' (dead-letter)."""

    __tablename__ = "outbox"
    id: Mapped[int] = mapped_column(primary_key=True)
    topic: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(8), default="pending", index=True)  # pending | sent | dead
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
