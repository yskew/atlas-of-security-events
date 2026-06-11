"""Test config. Point the DB at a throwaway SQLite file and disable Gemini —
set BEFORE importing any pipeline module (config reads env at import time)."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_pipeline.db"
os.environ["GEMINI_API_KEYS"] = ""          # no network in tests
os.environ["HARD_PURGE_AFTER_DAYS"] = "90"
os.environ["REVERIFY_AFTER_DAYS"] = "7"

import pytest  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from pipeline.db import Base, get_engine  # noqa: E402


@pytest.fixture
def session():
    """Fresh schema per test (single temp SQLite file), yields a Session."""
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        yield s
