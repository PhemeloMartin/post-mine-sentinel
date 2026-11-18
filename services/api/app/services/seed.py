"""Idempotent bootstrap: load the validated mine register, pilot deployments and demo users."""

from __future__ import annotations

import json
import logging
import secrets

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import Settings
from ..core.security import hash_password
from ..db.models import Mine, Organisation, SensorNode, Site, SiteBelief, User

log = logging.getLogger("sentinel.seed")

NODE_MOUNTS = ["headframe", "headframe", "collar", "collar", *(["fence"] * 8), "ruin", "ruin",
               *(["rock"] * 6), "path", "path", "tailings", "road"]

DEMO_USERS = [
    ("admin", "Platform Administrator", "admin", "Post-Mine Sentinel Operations"),
    ("analyst", "Duty Analyst, SOC-KOSH", "analyst", "Department of Mineral and Petroleum Resources"),
    ("officer", "Field Officer, SAPS", "field_officer", "SAPS Vala Umgodi"),
    ("auditor", "Auditor, Oversight", "auditor", "Auditor-General of South Africa"),
    ("liaison", "Community Liaison, Matlosana", "community_liaison", "City of Matlosana"),
]


def prior_from_rai(rai: float) -> float:
    return min(0.35, max(0.02, 0.02 + 0.33 * (rai / 100) ** 2))


def seed(db: Session, settings: Settings) -> None:
    if db.scalar(select(func.count()).select_from(Mine)):
        return
    register = json.loads((settings.data_dir / "mines" / "sa_mines.json").read_text(encoding="utf-8"))
    for m in register["mines"]:
        db.add(Mine(
            id=m["id"], name=m["name"], commodity=m["commodity"], province=m["province"], locality=m["locality"],
            lat=m["lat"], lon=m["lon"], precision_m=m["precisionM"], field=m["field"], method=m["method"],
            status=m["status"], opened=m["opened"], closed=m["closed"], max_depth_m=m["maxDepthM"],
            production=m["production"], residual=m["residual"], illegal_reported=m["illegalActivity"]["reported"],
            illegal_last_year=m["illegalActivity"]["lastReportedYear"], notes=m["notes"], rai=m["risk"]["rai"],
            rai_band=m["risk"]["band"], rai_factors=m["risk"]["factors"], rai_contributions=m["risk"]["contributions"],
        ))
    db.flush()

    network = json.loads((settings.data_dir / "network" / "sentinel_network.json").read_text(encoding="utf-8"))
    rai_by_id = {m["id"]: m["risk"]["rai"] for m in register["mines"]}
    for d in network["deployments"]:
        prior = prior_from_rai(rai_by_id[d["mineId"]])
        site = Site(mine_id=d["mineId"], hub=d["hub"], phase=d["phase"], backhaul=d["backhaul"], prior=prior)
        for i in range(d["spiders"]):
            site.nodes.append(SensorNode(id=f"{d['mineId']}:S{i + 1:02d}", mount=NODE_MOUNTS[i % len(NODE_MOUNTS)]))
        for a in range(d["anchors"]):
            site.nodes.append(SensorNode(id=f"{d['mineId']}:A{a + 1}", kind="anchor", mount="mast"))
        db.add(site)
        db.flush()
        from ..services.fusion import logit  # local import avoids a cycle at module import time

        db.add(SiteBelief(site_id=site.id, log_odds=logit(prior)))

    if settings.seed_demo:
        password = settings.demo_password.get_secret_value() if settings.demo_password else None
        if not password:
            password = secrets.token_urlsafe(12)
            log.warning("generated demo password (set SENTINEL_DEMO_PASSWORD to choose one)",
                        extra={"demo_password": password})
        orgs: dict[str, Organisation] = {}
        for username, display, role, org in DEMO_USERS:
            if org not in orgs:
                orgs[org] = Organisation(name=org, kind="government")
                db.add(orgs[org])
                db.flush()
            db.add(User(username=username, display_name=display, role=role, organisation_id=orgs[org].id,
                        password_hash=hash_password(password)))
    db.commit()
    log.info("seeded register", extra={"mines": len(register["mines"]), "sites": len(network["deployments"])})
