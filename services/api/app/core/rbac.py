"""Role-based access control (least privilege, need-to-know).

The matrix is the single source of truth; the web console mirrors it for UX only.
"""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    ADMIN = "admin"
    ANALYST = "analyst"
    FIELD_OFFICER = "field_officer"
    AUDITOR = "auditor"
    COMMUNITY_LIAISON = "community_liaison"


class Perm(StrEnum):
    VIEW_ALL = "view_all"
    VIEW_GENERALISED = "view_generalised"
    PRECISE_LOCATION = "precise_location"
    LIVE_ALERTS = "live_alerts"
    PLAN_INSPECTIONS = "plan_inspections"
    UPDATE_CASES = "update_cases"
    MANAGE_NODES = "manage_nodes"
    MANAGE_USERS = "manage_users"
    VIEW_AUDIT = "view_audit"
    EXPORT = "export"


MATRIX: dict[Role, frozenset[Perm]] = {
    Role.ADMIN: frozenset({Perm.VIEW_ALL, Perm.PRECISE_LOCATION, Perm.LIVE_ALERTS, Perm.MANAGE_NODES,
                           Perm.MANAGE_USERS, Perm.VIEW_AUDIT, Perm.EXPORT}),
    Role.ANALYST: frozenset({Perm.VIEW_ALL, Perm.PRECISE_LOCATION, Perm.LIVE_ALERTS, Perm.PLAN_INSPECTIONS,
                             Perm.EXPORT}),
    Role.FIELD_OFFICER: frozenset({Perm.PRECISE_LOCATION, Perm.LIVE_ALERTS, Perm.UPDATE_CASES}),
    Role.AUDITOR: frozenset({Perm.VIEW_ALL, Perm.VIEW_AUDIT}),
    Role.COMMUNITY_LIAISON: frozenset({Perm.VIEW_GENERALISED}),
}


def has_perm(role: str, perm: Perm) -> bool:
    try:
        return perm in MATRIX[Role(role)]
    except ValueError:
        return False


GENERALISE_DEG = 0.05  # ≈ 5 km grid


def generalise(lat: float, lon: float) -> tuple[float, float]:
    """Snap to a coarse grid so low-clearance users cannot locate active shafts."""
    return round(round(lat / GENERALISE_DEG) * GENERALISE_DEG, 4), round(round(lon / GENERALISE_DEG) * GENERALISE_DEG, 4)
