import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parents[1] / "ml"))

_DB = Path(tempfile.mkdtemp()) / "sentinel-test.sqlite3"
os.environ.update({
    "SENTINEL_ENV": "test",
    "SENTINEL_DATABASE_URL": f"sqlite:///{_DB.as_posix()}",
    "SENTINEL_DEMO_PASSWORD": "Sentinel!Demo2026",
    "SENTINEL_INGEST_TOKEN": "test-ingest-token",
    "SENTINEL_JWT_SECRET": "test-secret-" + "x" * 40,
})

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402

PASSWORD = "Sentinel!Demo2026"


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """The login limiter is process-global (Redis in prod); isolate tests from each other."""
    from app.api import routes

    routes._attempts.clear()
    yield


@pytest.fixture(scope="session")
def client():
    with TestClient(create_app()) as c:
        yield c


def login(client, username: str) -> dict[str, str]:
    # Session-scoped user fixtures are created before function-scoped autouse fixtures run,
    # so clear the limiter here too.
    from app.api import routes

    routes._attempts.clear()
    r = client.post("/api/v1/auth/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def analyst(client):
    return login(client, "analyst")


@pytest.fixture(scope="session")
def liaison(client):
    return login(client, "liaison")


@pytest.fixture(scope="session")
def auditor(client):
    return login(client, "auditor")


SERVICE = {"X-Service-Token": "test-ingest-token"}
