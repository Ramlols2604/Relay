"""Pin the app clock so tests with hardcoded October 2026 windows stay valid."""

from datetime import datetime, timezone

import app.clock
import app.extract
import app.logic
import app.snowflake_store

FROZEN_NOW = datetime(2026, 10, 16, 12, 0, 0, tzinfo=timezone.utc)

# Modules that did `from app.clock import now` hold their own reference.
_PATCH_TARGETS = [
    (app.clock, "now"),
    (app.logic, "now"),
    (app.snowflake_store, "now"),
    (app.extract, "utcnow"),
]


def frozen_now() -> datetime:
    return FROZEN_NOW


def freeze(monkeypatch) -> None:
    for module, name in _PATCH_TARGETS:
        monkeypatch.setattr(module, name, frozen_now)


def freeze_module_clocks() -> None:
    """Pin the clock without pytest, for worker processes started by tests."""
    for module, name in _PATCH_TARGETS:
        setattr(module, name, frozen_now)
