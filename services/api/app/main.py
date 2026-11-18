"""Application factory.

    uvicorn app.main:app --reload            # dev (SQLite, demo seed)
    SENTINEL_ENV=prod ... gunicorn -k uvicorn.workers.UvicornWorker app.main:app
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from . import __version__
from .api.routes import router
from .core.config import Settings, get_settings
from .core.errors import install_error_handlers
from .core.logging import RequestContextMiddleware, configure_logging
from .db.session import Base, _factory, get_engine
from .services.seed import seed

log = logging.getLogger("sentinel.api")

REQUIRED_PROD_SECRETS = ("SENTINEL_JWT_SECRET", "SENTINEL_INGEST_TOKEN", "SENTINEL_EVIDENCE_SIGNING_KEY_HEX",
                         "SENTINEL_DATABASE_URL")


def _check_production(settings: Settings) -> None:
    """Fail fast at boot rather than run insecurely (secure-by-default)."""
    if not settings.is_prod:
        return
    missing = [k for k in REQUIRED_PROD_SECRETS if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"refusing to start in prod without: {', '.join(missing)}")
    if settings.database_url.startswith("sqlite"):
        raise RuntimeError("SQLite is not permitted in production")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()
    _check_production(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        engine = get_engine(settings.database_url)
        if not settings.is_prod:  # prod schema is owned by Alembic migrations
            Base.metadata.create_all(engine)
        with _factory(settings.database_url)() as db:
            seed(db, settings)
        log.info("api ready", extra={"version": __version__, "env": settings.env})
        yield

    app = FastAPI(
        title="Post-Mine Sentinel API",
        version=__version__,
        description="National early-warning platform against illegal mining at South Africa's derelict mines.",
        lifespan=lifespan,
        docs_url=None if settings.is_prod else "/docs",
        redoc_url=None,
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)
    app.include_router(router)
    return app


app = create_app()
