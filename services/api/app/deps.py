"""Request-scoped dependencies: current principal, permission guards, service auth."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .core import audit
from .core.config import Settings, get_settings
from .core.errors import Forbidden, Unauthorized
from .core.rbac import Perm, has_perm
from .core.security import decode_access_token, verify_service_token
from .db.session import get_db

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Principal:
    username: str
    role: str
    org: str | None

    def can(self, perm: Perm) -> bool:
        return has_perm(self.role, perm)


def current_principal(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> Principal:
    if creds is None or creds.scheme.lower() != "bearer":
        raise Unauthorized("Bearer token required.", headers={"WWW-Authenticate": "Bearer"})
    claims = decode_access_token(settings, creds.credentials)
    return Principal(username=claims["sub"], role=claims["role"], org=claims.get("org"))


def require(perm: Perm) -> Callable[..., Principal]:
    """Dependency factory: 403 (and an audited 'deny') when the role lacks the permission."""

    def guard(request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> Principal:
        if not p.can(perm):
            audit.record(db, actor=p.username, role=p.role, action=f"perm.{perm.value}", resource=request.url.path,
                         outcome="deny", ip=request.client.host if request.client else None)
            db.commit()
            raise Forbidden(f"Your role ({p.role}) does not have '{perm.value}'.")
        return p

    return guard


def service_auth(x_service_token: str | None = Header(default=None), settings: Settings = Depends(get_settings)) -> str:
    verify_service_token(settings, x_service_token)
    return "ingest-service"
