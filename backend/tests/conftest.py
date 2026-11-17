import os

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["GEMINI_API_KEY"] = ""
for key in (
    "SNOWFLAKE_ACCOUNT",
    "SNOWFLAKE_USER",
    "SNOWFLAKE_PASSWORD",
    "SNOWFLAKE_WAREHOUSE",
    "SNOWFLAKE_DATABASE",
    "SNOWFLAKE_SCHEMA",
    "SNOWFLAKE_ROLE",
):
    os.environ[key] = ""

import pytest
from fastapi.testclient import TestClient

from app.db import reset_db
from app.main import app
from tests.frozen_clock import freeze


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    freeze(monkeypatch)


@pytest.fixture
def client():
    reset_db()
    with TestClient(app) as test_client:
        yield test_client
