"""Point the app at throw-away storage and database folders before it is imported."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
SAMPLES = ROOT / "samples"

_tmp = tempfile.mkdtemp(prefix="ptb-tests-")
os.environ["STORAGE_DIR"] = str(Path(_tmp) / "storage")
os.environ["DATA_DIR"] = str(Path(_tmp) / "data")
# never the real database or bucket: ignore backend/.env and anything inherited from the shell
os.environ["ENV_FILE"] = ""
os.environ["GOOGLE_FONTS"] = "off"  # tests never download fonts
for _name in ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "AUTH", "ALLOW_SIGNUP", "SECRET_KEY",
              "SHARED_TEMPLATES", "FRONTEND_DIR"):
    os.environ.pop(_name, None)
sys.path.insert(0, str(BACKEND))


@pytest.fixture(scope="session")
def samples() -> Path:
    if not (SAMPLES / "invoice.pdf").is_file():
        pytest.skip("sample PDFs missing: run `python scripts/make_samples.py` first")
    return SAMPLES


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


def upload(client, path: Path, **data):
    with path.open("rb") as fh:
        return client.post("/api/upload", files={"file": (path.name, fh, "application/pdf")}, data=data)
