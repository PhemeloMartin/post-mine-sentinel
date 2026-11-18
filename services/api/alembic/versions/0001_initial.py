"""Initial schema + PostgreSQL-specific hardening (PostGIS, TimescaleDB, immutable audit log).

Revision ID: 0001
Revises:
Create Date: 2026-11-18
"""

from alembic import op

from app.db import models  # noqa: F401
from app.db.session import Base

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

POSTGRES_DDL = [
    # Extensions (pre-installed in timescale/timescaledb-ha and allow-listed on Azure Flexible Server).
    "CREATE EXTENSION IF NOT EXISTS postgis",
    "CREATE EXTENSION IF NOT EXISTS timescaledb",
    # Spatial: generated geography column + GiST index → ST_DWithin queries ("sites within 50 km").
    """ALTER TABLE mines ADD COLUMN IF NOT EXISTS geom geography(Point, 4326)
       GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED""",
    "CREATE INDEX IF NOT EXISTS ix_mines_geom ON mines USING GIST (geom)",
    # Time series: hypertables require the time column in every unique constraint.
    "ALTER TABLE detections DROP CONSTRAINT IF EXISTS detections_pkey",
    "ALTER TABLE detections ADD PRIMARY KEY (id, window_start)",
    "ALTER TABLE detections DROP CONSTRAINT IF EXISTS uq_detection_frame",
    "ALTER TABLE detections ADD CONSTRAINT uq_detection_frame UNIQUE (node_id, frame_counter, window_start)",
    "SELECT create_hypertable('detections', 'window_start', chunk_time_interval => INTERVAL '7 days', migrate_data => true)",
    "ALTER TABLE detections SET (timescaledb.compress, timescaledb.compress_segmentby = 'site_id')",
    "SELECT add_compression_policy('detections', INTERVAL '30 days')",
    "SELECT add_retention_policy('detections', INTERVAL '5 years')",  # POPIA s14 retention schedule
    # Continuous aggregate for dashboards: threat votes per site per hour.
    """CREATE MATERIALIZED VIEW IF NOT EXISTS site_activity_hourly
       WITH (timescaledb.continuous) AS
       SELECT site_id, time_bucket(INTERVAL '1 hour', window_start) AS bucket,
              count(*) FILTER (WHERE kind = 'seismic') AS threat_votes,
              count(*) FILTER (WHERE kind = 'benign')  AS benign_votes,
              max(p_threat) AS max_p
       FROM detections GROUP BY site_id, bucket WITH NO DATA""",
    # Append-only audit log: even a compromised application account cannot rewrite history.
    """CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION 'audit_log is append-only (attempted %)', TG_OP USING ERRCODE = 'insufficient_privilege';
       END $$""",
    "DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log",
    """CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
       FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation()""",
]


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind)
    if bind.dialect.name == "postgresql":
        for stmt in POSTGRES_DDL:
            op.execute(stmt)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP MATERIALIZED VIEW IF EXISTS site_activity_hourly")
        op.execute("DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log")
    Base.metadata.drop_all(bind)
