"""Snowflake reads and writes.

INVENTORY is the teammate's uploaded dataset. REQUESTS is where confirmed
needs, offers, and borrow asks go once credentials exist. Both statements
are isolated so the column names can be pointed at the real table later.
"""

import json
import logging
import threading
import time
from contextlib import contextmanager
from datetime import datetime

from app.clock import aware, now
from app.config import snowflake_settings

logger = logging.getLogger(__name__)

_lock = threading.RLock()
_cached_conn = None
_residents_ddl_done = False
_inventory_ddl_done = False

# Expected INVENTORY columns. Change this query when the upload is visible.
INVENTORY_SQL = """
SELECT
    INVENTORY_ID,
    RESIDENT_ID,
    RESIDENT_NAME,
    X,
    Y,
    CATALOG_ITEM,
    QUANTITY,
    WILLING_TO_LEND,
    CONDITION_NOTE,
    AVAILABLE_WINDOWS,
    CATEGORY,
    CONDITION
FROM INVENTORY
WHERE COALESCE(IS_SAMPLE, FALSE) = FALSE
"""

REQUEST_INSERT_SQL = """
INSERT INTO REQUESTS (
    ID, RESIDENT_ID, KIND, RAW_TEXT, CATALOG_ITEM, QUANTITY,
    AREA, WINDOW_START, WINDOW_END, STATUS, CREATED_AT
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
"""

REQUESTS_SQL = """
SELECT
    ID, RESIDENT_ID, KIND, RAW_TEXT, CATALOG_ITEM, QUANTITY,
    AREA, WINDOW_START, WINDOW_END, STATUS, CREATED_AT
FROM REQUESTS
"""

REQUEST_UPDATE_SQL = """
UPDATE REQUESTS
SET STATUS = %s, QUANTITY = %s
WHERE ID = %s
"""


class SnowflakeError(RuntimeError):
    pass


class InventorySaveError(Exception):
    """Write failed after the previous row was read; carry previous for compensation."""

    def __init__(self, cause: BaseException, previous: dict | None):
        super().__init__(str(cause))
        self.cause = cause
        self.previous = previous


def configured() -> bool:
    return snowflake_settings() is not None


def status() -> dict:
    if not configured():
        return {"snowflake": "not_configured"}
    try:
        with _connection() as conn:
            started = time.perf_counter()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            _log_ms("status.ping", started)
        return {"snowflake": "ok"}
    except Exception as exc:
        return {"snowflake": "error", "snowflake_message": str(exc)}


def fetch_inventory() -> dict:
    if not configured():
        return {"snowflake": "not_configured", "items": []}
    try:
        with _connection() as conn:
            started = time.perf_counter()
            cursor = conn.cursor()
            try:
                cursor.execute(INVENTORY_SQL)
            except Exception as exc:
                # Older warehouses may not have IS_SAMPLE yet; still serve real rows.
                if "IS_SAMPLE" not in str(exc).upper():
                    raise
                cursor.execute(
                    """
                    SELECT
                        INVENTORY_ID, RESIDENT_ID, RESIDENT_NAME, X, Y, CATALOG_ITEM, QUANTITY,
                        WILLING_TO_LEND, CONDITION_NOTE, AVAILABLE_WINDOWS, CATEGORY, CONDITION
                    FROM INVENTORY
                    """
                )
            columns = [col[0].lower() for col in cursor.description]
            items = [dict(zip(columns, row)) for row in cursor.fetchall()]
            _log_ms("fetch_inventory", started)
        return {"snowflake": "ok", "items": items}
    except Exception as exc:
        return {"snowflake": "error", "snowflake_message": str(exc), "items": []}


def insert_request(row: dict) -> None:
    if not configured():
        return
    try:
        with _connection() as conn:
            started = time.perf_counter()
            cursor = conn.cursor()
            cursor.execute(
                REQUEST_INSERT_SQL,
                (
                    row["id"],
                    row["resident_id"],
                    row["kind"],
                    row["raw_text"],
                    row["catalog_item_id"],
                    row["quantity"],
                    row.get("area"),
                    _iso(row.get("window_start")),
                    _iso(row.get("window_end")),
                    "open",
                    _iso(row.get("created_at")) or now().isoformat(timespec="seconds"),
                ),
            )
            conn.commit()
            _log_ms("insert_request", started)
    except Exception as exc:
        raise SnowflakeError(str(exc)) from exc


def fetch_requests() -> list[dict]:
    if not configured():
        return []
    try:
        with _connection() as conn:
            started = time.perf_counter()
            cursor = conn.cursor()
            cursor.execute(REQUESTS_SQL)
            columns = [col[0].lower() for col in cursor.description]
            rows = []
            for raw in cursor.fetchall():
                item = dict(zip(columns, raw))
                rows.append(_normalize_request(item))
            _log_ms("fetch_requests", started)
        return rows
    except Exception as exc:
        raise SnowflakeError(str(exc)) from exc


RESIDENTS_DDL = """
CREATE TABLE IF NOT EXISTS RESIDENTS (
    CLERK_USER_ID VARCHAR NOT NULL,
    NAME          VARCHAR NOT NULL,
    EMAIL         VARCHAR,
    INITIALS      VARCHAR,
    STREET        VARCHAR,
    ASSIGNED_RESIDENT_ID VARCHAR,
    UPDATED_AT    TIMESTAMP_TZ
)
"""

RESIDENTS_COLUMN_DDL = "ALTER TABLE RESIDENTS ADD COLUMN IF NOT EXISTS ASSIGNED_RESIDENT_ID VARCHAR"


def upsert_profile(
    clerk_user_id: str,
    name: str,
    email: str,
    initials: str,
    street: str,
    city: str = "",
    about: str = "",
) -> str:
    """One account keeps its own resident id. It does not borrow a demo neighbor."""
    if not configured():
        raise SnowflakeError("Snowflake is not configured")
    assigned = clerk_user_id
    try:
        with _connection() as conn:
            started = time.perf_counter()
            cursor = conn.cursor()
            _ensure_residents_once(cursor)
            cursor.execute(
                "SELECT ASSIGNED_RESIDENT_ID FROM RESIDENTS WHERE CLERK_USER_ID = %s",
                (clerk_user_id,),
            )
            existing = cursor.fetchone()
            if existing:
                cursor.execute(
                    """
                    UPDATE RESIDENTS
                    SET NAME = %s, EMAIL = %s, INITIALS = %s, STREET = %s,
                        ASSIGNED_RESIDENT_ID = %s, UPDATED_AT = CURRENT_TIMESTAMP()
                    WHERE CLERK_USER_ID = %s
                    """,
                    (name, email, initials, street, assigned, clerk_user_id),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO RESIDENTS (
                        CLERK_USER_ID, NAME, EMAIL, INITIALS, STREET, ASSIGNED_RESIDENT_ID, UPDATED_AT
                    ) VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP())
                    """,
                    (clerk_user_id, name, email, initials, street, assigned),
                )
            conn.commit()
            _log_ms("upsert_profile", started)
            return assigned
    except Exception as exc:
        raise SnowflakeError(str(exc)) from exc


def _ensure_residents_once(cursor) -> None:
    global _residents_ddl_done
    if _residents_ddl_done:
        return
    started = time.perf_counter()
    try:
        cursor.execute(RESIDENTS_DDL)
    except Exception as exc:
        message = str(exc)
        if "Insufficient privileges" not in message and "already exists" not in message.lower():
            raise
    try:
        cursor.execute(RESIDENTS_COLUMN_DDL)
    except Exception as exc:
        message = str(exc)
        if "Insufficient privileges" not in message and "already exists" not in message.lower():
            raise
    _residents_ddl_done = True
    _log_ms("ensure_residents_ddl", started)


def _next_open_resident(cursor) -> str:
    cursor.execute(
        "SELECT DISTINCT RESIDENT_ID FROM INVENTORY WHERE RESIDENT_ID IS NOT NULL ORDER BY RESIDENT_ID"
    )
    pool = [row[0] for row in cursor.fetchall() if row[0]]
    cursor.execute(
        "SELECT ASSIGNED_RESIDENT_ID FROM RESIDENTS WHERE ASSIGNED_RESIDENT_ID IS NOT NULL"
    )
    assigned = [row[0] for row in cursor.fetchall() if row[0]]
    taken = set(assigned)
    for candidate in pool:
        if candidate not in taken:
            return candidate
    if not pool:
        return "avery"
    counts = {candidate: 0 for candidate in pool}
    for owner in assigned:
        if owner in counts:
            counts[owner] += 1
    return min(pool, key=lambda candidate: (counts[candidate], candidate))


INVENTORY_INSERT_SQL = """
INSERT INTO INVENTORY (
    INVENTORY_ID, RESIDENT_ID, RESIDENT_NAME, X, Y, CATALOG_ITEM, QUANTITY,
    WILLING_TO_LEND, CONDITION_NOTE, AVAILABLE_WINDOWS, CATEGORY, CONDITION, IS_SAMPLE
)
SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s, PARSE_JSON(%s), %s, %s, %s
WHERE NOT EXISTS (
    SELECT 1 FROM INVENTORY WHERE INVENTORY_ID = %s
)
"""

INVENTORY_UPDATE_SQL = """
UPDATE INVENTORY
SET RESIDENT_ID = %s,
    RESIDENT_NAME = %s,
    X = %s,
    Y = %s,
    CATALOG_ITEM = %s,
    QUANTITY = %s,
    WILLING_TO_LEND = %s,
    CONDITION_NOTE = %s,
    CATEGORY = %s,
    CONDITION = %s
WHERE INVENTORY_ID = %s
"""

INVENTORY_DELETE_SQL = """
DELETE FROM INVENTORY
WHERE INVENTORY_ID = %s
"""


def ensure_inventory_identity() -> None:
    """Add the stable id columns without recreating INVENTORY."""
    global _inventory_ddl_done
    if not configured() or _inventory_ddl_done:
        return
    statements = (
        "ALTER TABLE INVENTORY ADD COLUMN IF NOT EXISTS INVENTORY_ID VARCHAR",
        "ALTER TABLE INVENTORY ADD COLUMN IF NOT EXISTS CATEGORY VARCHAR",
        "ALTER TABLE INVENTORY ADD COLUMN IF NOT EXISTS CONDITION VARCHAR",
        "ALTER TABLE INVENTORY ADD COLUMN IF NOT EXISTS IS_SAMPLE BOOLEAN DEFAULT FALSE",
    )
    try:
        with _connection() as conn:
            started = time.perf_counter()
            cursor = conn.cursor()
            for statement in statements:
                cursor.execute(statement)
            conn.commit()
            _inventory_ddl_done = True
            _log_ms("ensure_inventory_identity", started)
    except Exception as exc:
        raise SnowflakeError(str(exc)) from exc


def count_inventory() -> int | None:
    if not configured():
        return None
    try:
        with _connection() as conn:
            started = time.perf_counter()
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM INVENTORY")
            row = cursor.fetchone()
            _log_ms("count_inventory", started)
        return int(row[0]) if row else 0
    except Exception as exc:
        raise SnowflakeError(str(exc)) from exc


def count_sample_inventory() -> int | None:
    """Rows already marked IS_SAMPLE=true, so a rebuild can skip when there are enough."""
    if not configured():
        return None
    try:
        with _connection() as conn:
            started = time.perf_counter()
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM INVENTORY WHERE COALESCE(IS_SAMPLE, FALSE) = TRUE")
            row = cursor.fetchone()
            _log_ms("count_sample_inventory", started)
        return int(row[0]) if row else 0
    except Exception as exc:
        raise SnowflakeError(str(exc)) from exc


def insert_inventory_many(rows: list[dict], batch_size: int = 200) -> None:
    if not configured() or not rows:
        return
    payload = [_inventory_params(row) for row in rows]
    try:
        with _connection() as conn:
            started = time.perf_counter()
            cursor = conn.cursor()
            for start in range(0, len(payload), batch_size):
                cursor.executemany(INVENTORY_INSERT_SQL, payload[start : start + batch_size])
            conn.commit()
            _log_ms("insert_inventory_many", started)
    except Exception as exc:
        raise SnowflakeError(str(exc)) from exc


def upsert_inventory(row: dict) -> None:
    if not configured():
        return
    _run_with_stale_retry("upsert_inventory", lambda conn: _upsert_inventory_on(conn, row))


def fetch_inventory_row(inventory_id: str) -> dict | None:
    if not configured():
        return None

    def work(conn):
        return _fetch_inventory_row_on(conn, inventory_id)

    return _run_with_stale_retry("fetch_inventory_row", work)


def save_inventory_row(row: dict) -> dict | None:
    """Read the previous row and write the new one on one cached connection."""
    if not configured():
        return None
    for attempt in range(2):
        previous: dict | None = None
        try:
            with _connection() as conn:
                started = time.perf_counter()
                fetched = _fetch_inventory_row_on(conn, str(row["inventory_id"]))
                previous = dict(fetched) if fetched is not None else None
                try:
                    _upsert_inventory_on(conn, row)
                    conn.commit()
                except Exception as write_exc:
                    if _looks_stale(write_exc) and attempt == 0:
                        _discard_connection()
                        raise
                    raise InventorySaveError(write_exc, previous) from write_exc
                _log_ms("save_inventory_row", started)
                return previous
        except InventorySaveError:
            raise
        except Exception as exc:
            if _looks_stale(exc) and attempt == 0:
                continue
            raise SnowflakeError(str(exc)) from exc
    raise SnowflakeError("snowflake save failed")


def delete_inventory_by_id(inventory_id: str) -> None:
    if not configured():
        return
    try:
        with _connection() as conn:
            started = time.perf_counter()
            cursor = conn.cursor()
            cursor.execute(INVENTORY_DELETE_SQL, (inventory_id,))
            conn.commit()
            _log_ms("delete_inventory_by_id", started)
    except Exception as exc:
        raise SnowflakeError(str(exc)) from exc


INVENTORY_ROW_SQL = """
SELECT
    INVENTORY_ID,
    RESIDENT_ID,
    RESIDENT_NAME,
    X,
    Y,
    CATALOG_ITEM,
    QUANTITY,
    WILLING_TO_LEND,
    CONDITION_NOTE,
    AVAILABLE_WINDOWS,
    CATEGORY,
    CONDITION
FROM INVENTORY
WHERE INVENTORY_ID = %s
"""


def _fetch_inventory_row_on(conn, inventory_id: str) -> dict | None:
    cursor = conn.cursor()
    cursor.execute(INVENTORY_ROW_SQL, (inventory_id,))
    raw = cursor.fetchone()
    if raw is None:
        return None
    columns = [col[0].lower() for col in cursor.description]
    return dict(zip(columns, raw))


def _upsert_inventory_on(conn, row: dict) -> None:
    cursor = conn.cursor()
    cursor.execute(INVENTORY_UPDATE_SQL, _inventory_update_params(row))
    if cursor.rowcount == 0:
        cursor.execute(INVENTORY_INSERT_SQL, _inventory_params(row))


def ensure_sample_column() -> None:
    """Ensure IS_SAMPLE exists so sample bulk loads never mix into matching."""
    ensure_inventory_identity()


def delete_sample_inventory() -> None:
    if not configured():
        return
    try:
        with _connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM INVENTORY WHERE COALESCE(IS_SAMPLE, FALSE) = TRUE")
            conn.commit()
    except Exception as exc:
        raise SnowflakeError(str(exc)) from exc


def _inventory_params(row: dict) -> tuple:
    inventory_id = row.get("inventory_id") or f"{row['resident_id']}:{row['catalog_item']}"
    windows = row.get("available_windows") or []
    return (
        inventory_id,
        row["resident_id"],
        row["resident_name"],
        row.get("x") or 0,
        row.get("y") or 0,
        row["catalog_item"],
        int(row["quantity"]) if row.get("quantity") is not None else 1,
        bool(row.get("willing_to_lend", True)),
        row.get("condition_note") or "",
        json.dumps(windows),
        row.get("category") or "",
        row.get("condition") or "",
        bool(row.get("is_sample", False)),
        inventory_id,
    )


def _inventory_update_params(row: dict) -> tuple:
    return (
        row["resident_id"],
        row["resident_name"],
        row.get("x") or 0,
        row.get("y") or 0,
        row["catalog_item"],
        int(row["quantity"]) if row.get("quantity") is not None else 1,
        bool(row.get("willing_to_lend")),
        row.get("condition_note") or "",
        row.get("category") or "",
        row.get("condition") or "",
        row["inventory_id"],
    )


def update_request(request_id: str, status: str, quantity: int) -> None:
    if not configured():
        return
    try:
        with _connection() as conn:
            started = time.perf_counter()
            cursor = conn.cursor()
            cursor.execute(REQUEST_UPDATE_SQL, (status, quantity, request_id))
            conn.commit()
            _log_ms("update_request", started)
    except Exception as exc:
        raise SnowflakeError(str(exc)) from exc


def reset_connection_cache() -> None:
    """Test helper: drop the cached connection and DDL flags."""
    global _cached_conn, _residents_ddl_done, _inventory_ddl_done
    with _lock:
        if _cached_conn is not None:
            try:
                _cached_conn.close()
            except Exception:
                pass
        _cached_conn = None
        _residents_ddl_done = False
        _inventory_ddl_done = False


def _run_with_stale_retry(label: str, work):
    for attempt in range(2):
        try:
            with _connection() as conn:
                started = time.perf_counter()
                result = work(conn)
                if label != "fetch_inventory_row":
                    conn.commit()
                _log_ms(label, started)
                return result
        except Exception as exc:
            if _looks_stale(exc) and attempt == 0:
                continue
            raise SnowflakeError(str(exc)) from exc
    raise SnowflakeError(f"snowflake {label} failed")


@contextmanager
def _connection():
    with _lock:
        conn = _alive_connection()
        try:
            yield conn
        except Exception as exc:
            if _looks_stale(exc):
                _discard_connection()
            raise


def _alive_connection():
    global _cached_conn
    if _cached_conn is not None:
        return _cached_conn
    started = time.perf_counter()
    _cached_conn = _open_connection()
    _log_ms("connect", started)
    return _cached_conn


def _discard_connection() -> None:
    global _cached_conn
    if _cached_conn is not None:
        try:
            _cached_conn.close()
        except Exception:
            pass
    _cached_conn = None


def _looks_stale(exc: BaseException) -> bool:
    message = str(exc).lower()
    markers = ("connection", "closed", "gone away", "broken", "not connected", "timeout", "eof")
    return any(mark in message for mark in markers)


def _open_connection():
    settings = snowflake_settings()
    if settings is None:
        raise SnowflakeError("Snowflake is not configured")
    try:
        import snowflake.connector
    except ImportError as exc:
        raise SnowflakeError("snowflake-connector-python is not installed") from exc
    return snowflake.connector.connect(
        account=settings["SNOWFLAKE_ACCOUNT"],
        user=settings["SNOWFLAKE_USER"],
        password=settings["SNOWFLAKE_PASSWORD"],
        warehouse=settings["SNOWFLAKE_WAREHOUSE"],
        database=settings["SNOWFLAKE_DATABASE"],
        schema=settings["SNOWFLAKE_SCHEMA"],
        role=settings["SNOWFLAKE_ROLE"],
        login_timeout=10,
        network_timeout=10,
    )


def _log_ms(label: str, started: float) -> None:
    elapsed = (time.perf_counter() - started) * 1000
    logger.info("snowflake.%s %.1fms", label, elapsed)


def _iso(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    return str(value)


def _normalize_request(item: dict) -> dict:
    return {
        "id": item.get("id"),
        "resident_id": item.get("resident_id"),
        "kind": item.get("kind"),
        "raw_text": item.get("raw_text") or "",
        "catalog_item_id": item.get("catalog_item"),
        "quantity": int(item.get("quantity") or 0),
        "area": item.get("area"),
        "window_start": _parse_dt(item.get("window_start")),
        "window_end": _parse_dt(item.get("window_end")),
        "status": item.get("status"),
        "created_at": _parse_dt(item.get("created_at")),
    }


def _parse_dt(value):
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        return aware(datetime.fromisoformat(value))
    return None
