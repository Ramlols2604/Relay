"""Snowflake connection reuse."""

from app import snowflake_store


class _FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self.rowcount = 1
        self.description = [
            ("INVENTORY_ID",),
            ("RESIDENT_ID",),
            ("RESIDENT_NAME",),
            ("X",),
            ("Y",),
            ("CATALOG_ITEM",),
            ("QUANTITY",),
            ("WILLING_TO_LEND",),
            ("CONDITION_NOTE",),
            ("AVAILABLE_WINDOWS",),
            ("CATEGORY",),
            ("CONDITION",),
        ]
        self._result = None

    def execute(self, sql, params=None):
        text = " ".join(str(sql).split()).lower()
        if text.startswith("select 1"):
            self._result = [(1,)]
            return
        if "from inventory where inventory_id" in text:
            item_id = params[0] if params else None
            row = self.conn.rows.get(item_id)
            self._result = [row] if row else []
            return
        if text.startswith("update inventory"):
            item_id = params[-1]
            if item_id in self.conn.rows:
                self.conn.rows[item_id] = (
                    item_id,
                    params[0],
                    params[1],
                    params[2],
                    params[3],
                    params[4],
                    params[5],
                    params[6],
                    params[7],
                    None,
                    params[8],
                    params[9],
                )
                self.rowcount = 1
            else:
                self.rowcount = 0
            self._result = []
            return
        if text.startswith("insert into inventory") or text.startswith("select %s"):
            item_id = params[0]
            self.conn.rows[item_id] = (
                item_id,
                params[1],
                params[2],
                params[3],
                params[4],
                params[5],
                params[6],
                params[7],
                params[8],
                None,
                params[10],
                params[11],
            )
            self.rowcount = 1
            self._result = []
            return
        self._result = []

    def fetchone(self):
        if not self._result:
            return None
        return self._result[0]

    def fetchall(self):
        return list(self._result or [])


class _FakeConn:
    def __init__(self, registry):
        self.registry = registry
        self.rows = registry.setdefault("rows", {})
        self.closed = False
        self.stale = False

    def cursor(self):
        if self.stale or self.closed:
            raise RuntimeError("connection closed")
        return _FakeCursor(self)

    def commit(self):
        if self.stale or self.closed:
            raise RuntimeError("connection closed")

    def close(self):
        self.closed = True


def _install_fake(monkeypatch):
    snowflake_store.reset_connection_cache()
    state = {"opens": 0, "rows": {}, "conns": []}

    def open_connection():
        state["opens"] += 1
        conn = _FakeConn(state)
        state["conns"].append(conn)
        return conn

    monkeypatch.setattr(snowflake_store, "configured", lambda: True)
    monkeypatch.setattr(snowflake_store, "snowflake_settings", lambda: {"ok": True})
    monkeypatch.setattr(snowflake_store, "_open_connection", open_connection)
    return state


def test_save_inventory_row_opens_at_most_one_connection(monkeypatch):
    state = _install_fake(monkeypatch)
    row = {
        "inventory_id": "avery:ladder",
        "resident_id": "avery",
        "resident_name": "Avery",
        "x": 0,
        "y": 0,
        "catalog_item": "Ladder",
        "quantity": 1,
        "willing_to_lend": True,
        "condition_note": "",
        "category": "Garden",
        "condition": "Good",
    }
    previous = snowflake_store.save_inventory_row(row)
    assert previous is None
    assert state["opens"] == 1
    snowflake_store.save_inventory_row({**row, "quantity": 2})
    assert state["opens"] == 1


def test_stale_connection_is_replaced(monkeypatch):
    state = _install_fake(monkeypatch)
    row = {
        "inventory_id": "avery:saw",
        "resident_id": "avery",
        "resident_name": "Avery",
        "x": 0,
        "y": 0,
        "catalog_item": "Saw",
        "quantity": 1,
        "willing_to_lend": True,
        "condition_note": "",
        "category": "Tools",
        "condition": "Good",
    }
    snowflake_store.save_inventory_row(row)
    assert state["opens"] == 1
    state["conns"][0].stale = True
    snowflake_store.save_inventory_row({**row, "quantity": 3})
    assert state["opens"] == 2
