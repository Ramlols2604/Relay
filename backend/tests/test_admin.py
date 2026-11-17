import pytest
from sqlmodel import select

from app.db import session_scope
from app.models import AuditLog, GroupBuy, GroupBuyMember, Loan


@pytest.fixture
def enforced(monkeypatch):
    """Turn real auth on. The bearer token itself is the Clerk user id."""
    monkeypatch.delenv("RELAY_AUTH_DISABLED", raising=False)
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_test_x")
    monkeypatch.setenv("CLERK_ISSUER", "https://clerk.example.test")
    monkeypatch.setenv("RELAY_ADMIN_USER_IDS", " user_admin , user_other_admin ")
    monkeypatch.setattr("app.auth._subject", lambda token: token)


def _as(user):
    return {"Authorization": f"Bearer {user}"}


ADMIN_ROUTES = [
    ("get", "/api/admin/me"),
    ("get", "/api/admin/overview"),
    ("get", "/api/admin/residents"),
    ("get", "/api/admin/loans"),
    ("get", "/api/admin/requests"),
    ("get", "/api/admin/group-buys"),
    ("get", "/api/admin/catalog"),
    ("get", "/api/admin/audit"),
    ("patch", "/api/admin/residents/avery"),
    ("delete", "/api/admin/residents/avery"),
    ("post", "/api/admin/loans/x/cancel"),
    ("post", "/api/admin/loans/x/force-return"),
    ("post", "/api/admin/requests/x/close"),
    ("delete", "/api/admin/group-buys/drill"),
    ("patch", "/api/admin/catalog/drill"),
]


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
def test_every_admin_route_rejects_anonymous_and_non_admins(client, enforced, method, path):
    anonymous = getattr(client, method)(path)
    assert anonymous.status_code == 401
    regular = getattr(client, method)(path, headers=_as("user_regular"))
    assert regular.status_code == 403
    # a resident id is not an admin just because it is real
    assert getattr(client, method)(path, headers=_as("avery")).status_code == 403


def test_admin_allowlist_is_trimmed_and_grants_access(client, enforced):
    assert client.get("/api/admin/me", headers=_as("user_admin")).json() == {"admin": True, "actor": "user_admin"}
    assert client.get("/api/admin/me", headers=_as("user_other_admin")).status_code == 200


def test_empty_allowlist_means_nobody_is_admin(client, enforced, monkeypatch):
    monkeypatch.setenv("RELAY_ADMIN_USER_IDS", "")
    assert client.get("/api/admin/me", headers=_as("")).status_code == 401
    assert client.get("/api/admin/me", headers=_as("user_admin")).status_code == 403


def test_overview_counts_and_integrations_never_leak_secrets(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "super-secret-gemini")
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_test_super_secret")
    data = client.get("/api/admin/overview").json()
    assert data["counts"]["residents"] >= 3
    assert data["counts"]["loans"] == 0
    assert data["integrations"]["gemini"] is True
    assert "secret" not in str(data).lower()


def test_resident_edit_validates_and_is_audited(client):
    ok = client.patch("/api/admin/residents/avery", json={"name": "  Avery   Chen  ", "city": "Charlotte"})
    assert ok.status_code == 200
    assert ok.json()["name"] == "Avery Chen"
    assert client.patch("/api/admin/residents/avery", json={"name": ""}).status_code == 422
    assert client.patch("/api/admin/residents/avery", json={"name": "x" * 81}).status_code == 422
    assert client.patch("/api/admin/residents/nobody", json={"name": "A"}).status_code == 404
    found = client.get("/api/admin/residents", params={"q": "charlotte"}).json()
    assert any(row["id"] == "avery" for row in found)
    assert client.get("/api/admin/residents", params={"q": "zzzz-none"}).json() == []
    entries = client.get("/api/admin/audit").json()
    assert entries[0]["action"] == "resident.update"
    assert entries[0]["target_id"] == "avery"
    assert entries[0]["detail"]["city"] == "Charlotte"


def _loan(client, item="drill", lender="jordan", borrower="avery", day=17):
    shelf = client.post(
        "/api/inventory",
        json={"resident_id": lender, "name": item.title(), "category": "Tools", "quantity": 1,
              "condition": "Good", "notes": "", "available_to_lend": True},
    )
    assert shelf.status_code == 201, shelf.text
    made = client.post(
        "/api/loans",
        json={"borrower_id": borrower, "lender_id": lender, "catalog_item_id": item,
              "inventory_id": shelf.json()["inventory_id"],
              "window_start": f"2026-10-{day}T09:00:00", "window_end": f"2026-10-{day}T11:00:00"},
    )
    assert made.status_code == 201, made.text
    return made.json()["loan_id"]


def test_resident_with_history_cannot_be_deleted_but_a_clean_one_can(client):
    _loan(client)
    blocked = client.delete("/api/admin/residents/jordan")
    assert blocked.status_code == 409
    clean = client.post(
        "/api/me",
        json={"clerk_user_id": "user_new", "name": "New Person", "email": "n@example.test", "initials": "NP", "street": "1 Test St"},
    )
    assert clean.status_code == 200, clean.text
    new_id = clean.json()["resident_id"]
    assert client.delete(f"/api/admin/residents/{new_id}").status_code == 200
    assert client.delete(f"/api/admin/residents/{new_id}").status_code == 404
    assert client.get("/api/admin/audit").json()[0]["action"] == "resident.delete"


def test_loan_cancel_and_force_return(client):
    first = _loan(client)
    cancelled = client.post(f"/api/admin/loans/{first}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "declined"
    assert client.post(f"/api/admin/loans/{first}/cancel").status_code == 409
    assert client.post("/api/admin/loans/nope/cancel").status_code == 404

    second = _loan(client, item="saw", lender="avery", borrower="sam", day=20)
    assert client.post(f"/api/admin/loans/{second}/force-return").status_code == 409
    client.post(f"/api/loans/{second}/respond", json={"action": "accept"})
    client.post(f"/api/loans/{second}/pickup")
    before = client.get("/api/garden").json()["count"]
    assert client.post(f"/api/admin/loans/{second}/force-return").json()["status"] == "returned"
    assert client.get("/api/garden").json()["count"] == before + 1

    by_status = client.get("/api/admin/loans", params={"status": "declined"}).json()
    assert [row["loan_id"] for row in by_status] == [first]
    assert client.get("/api/admin/loans", params={"status": "bogus"}).status_code == 422
    actions = [row["action"] for row in client.get("/api/admin/audit").json()]
    assert actions[:2] == ["loan.force_return", "loan.cancel"]


def test_group_buy_close_removes_members(client):
    client.post("/api/shared-demand/drill/group-buy", json={"resident_id": "avery"})
    client.post("/api/shared-demand/drill/group-buy/join", json={"resident_id": "sam"})
    assert len(client.get("/api/admin/group-buys").json()[0]["members"]) == 2
    closed = client.delete("/api/admin/group-buys/drill")
    assert closed.json() == {"closed": "drill", "members_removed": 2}
    assert client.get("/api/admin/group-buys").json() == []
    with session_scope() as session:
        assert session.exec(select(GroupBuy)).all() == []
        assert session.exec(select(GroupBuyMember)).all() == []
    assert client.delete("/api/admin/group-buys/drill").status_code == 404


def test_catalog_edit_changes_what_the_app_uses_and_validates(client):
    assert client.patch("/api/admin/catalog/drill", json={"demo_price_cents": 7500}).status_code == 200
    drill = next(row for row in client.get("/api/catalog").json() if row["id"] == "drill")
    assert drill["demo_price_cents"] == 7500
    for bad in ({"demo_price_cents": -1}, {"default_loan_hours": 0}, {"default_loan_hours": 721}, {"name": ""}):
        assert client.patch("/api/admin/catalog/drill", json=bad).status_code == 422
    assert client.patch("/api/admin/catalog/nope", json={"name": "x"}).status_code == 404


def test_requests_list_and_close(client):
    reply = client.post("/api/chat", json={"resident_id": "avery", "message": "I need a drill Saturday"}).json()
    assert reply["type"] == "confirmation"
    client.post("/api/chat", json={"resident_id": "avery", "message": "yes"})
    rows = client.get("/api/admin/requests").json()
    assert rows
    target = rows[0]["id"]
    assert client.post(f"/api/admin/requests/{target}/close").json() == {"id": target, "status": "closed"}
    assert client.post("/api/admin/requests/nope/close").status_code == 404
    assert next(row for row in client.get("/api/admin/requests").json() if row["id"] == target)["status"] == "closed"


def test_audit_log_limit_and_order(client):
    for hours in (1, 2, 3):
        client.patch("/api/admin/catalog/drill", json={"default_loan_hours": hours})
    entries = client.get("/api/admin/audit", params={"limit": 2}).json()
    assert len(entries) == 2
    assert entries[0]["detail"] == {"default_loan_hours": 3}
    assert len(client.get("/api/admin/audit", params={"limit": 0}).json()) == 1
    assert len(client.get("/api/admin/audit", params={"limit": 99999}).json()) == 3
    with session_scope() as session:
        assert len(session.exec(select(AuditLog)).all()) == 3
