"""Address verification validation and /api/me verified profile fields."""

from app.address import apply_verification, inside_us, is_address_verified, is_demo_street
from app.models import Resident


def _resident(**kwargs) -> Resident:
    base = dict(
        id="user_addr",
        name="Addr Person",
        short_name="Addr",
        street="100 Main Street",
        initials="AP",
        x=0,
        y=0,
        city="Cary",
    )
    base.update(kwargs)
    return Resident(**base)


def test_inside_us_and_demo_street_helpers():
    assert inside_us(35.79, -78.78)
    assert not inside_us(0, 0)
    assert not inside_us(51.5, -0.1)
    assert is_demo_street("14 Willow Court")
    assert is_demo_street("  14   willow   COURT ")
    assert not is_demo_street("100 Main Street")


def test_apply_verification_rejects_bad_coordinates():
    resident = _resident()
    try:
        apply_verification(
            resident,
            street="100 Main Street",
            city="Cary",
            latitude=0,
            longitude=0,
            formatted_address="100 Main Street, Cary, NC",
            state="NC",
        )
        assert False, "expected 422 for 0,0"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422
        assert "0,0" in str(exc.detail)

    try:
        apply_verification(
            resident,
            street="100 Main Street",
            city="Cary",
            latitude=48.85,
            longitude=2.35,
            formatted_address="100 Main Street, Cary, NC",
            state="NC",
        )
        assert False, "expected 422 for non-US"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422
        assert "United States" in str(exc.detail)


def test_apply_verification_rejects_wrong_city_and_missing_fields():
    resident = _resident(city="Cary")
    try:
        apply_verification(
            resident,
            street="100 Main Street",
            city="Cary",
            latitude=35.79,
            longitude=-78.78,
            formatted_address="100 Main Street, Raleigh, NC, United States",
            state="NC",
        )
        assert False, "expected 422 for city mismatch"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422
        assert "city" in str(exc.detail).lower()

    try:
        apply_verification(
            resident,
            street="100 Main Street",
            city="Cary",
            latitude=35.79,
            longitude=-78.78,
            formatted_address="",
            state="NC",
        )
        assert False, "expected 422 for missing formatted"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422

    try:
        apply_verification(
            resident,
            street="100 Main Street",
            city="Cary",
            latitude=35.79,
            longitude=None,
            formatted_address="100 Main Street, Cary, NC",
            state="NC",
        )
        assert False, "expected 422 for missing longitude"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422


def test_apply_verification_rejects_demo_street_even_with_coords():
    resident = _resident(street="14 Willow Court", city="Charlotte")
    try:
        apply_verification(
            resident,
            street="14 Willow Court",
            city="Charlotte",
            latitude=35.22,
            longitude=-80.84,
            formatted_address="14 Willow Court, Charlotte, NC",
            state="NC",
        )
        assert False, "expected 422 for demo street"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422
        assert "demo" in str(exc.detail).lower()


def test_apply_verification_accepts_valid_us_address():
    resident = _resident()
    apply_verification(
        resident,
        street="100 Main Street",
        city="Cary",
        latitude=35.7915,
        longitude=-78.7811,
        formatted_address="100 Main Street, Cary, North Carolina 27513, United States",
        state="NC",
    )
    assert is_address_verified(resident)
    assert resident.latitude == 35.7915
    assert resident.longitude == -78.7811
    assert resident.state == "NC"
    assert resident.verified_at is not None


def test_post_me_stores_verified_fields(client):
    saved = client.post(
        "/api/me",
        json={
            "clerk_user_id": "user_verified",
            "name": "Verified Person",
            "email": "v@example.test",
            "initials": "VP",
            "street": "100 Main Street",
            "city": "Cary",
            "about": "Near downtown",
            "latitude": 35.7915,
            "longitude": -78.7811,
            "formatted_address": "100 Main Street, Cary, North Carolina, United States",
            "state": "NC",
        },
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["address_verified"] is True
    assert body["latitude"] == 35.7915
    assert body["longitude"] == -78.7811
    assert body["state"] == "NC"
    assert "Cary" in body["formatted_address"]
    assert body["verified_at"]

    loaded = client.get("/api/me", params={"clerk_user_id": "user_verified"}).json()
    assert loaded["address_verified"] is True
    assert loaded["latitude"] == 35.7915


def test_post_me_rejects_bad_coords_and_wrong_city(client):
    bad = client.post(
        "/api/me",
        json={
            "clerk_user_id": "user_bad_coords",
            "name": "Bad Coords",
            "email": "b@example.test",
            "initials": "BC",
            "street": "100 Main Street",
            "city": "Cary",
            "latitude": 0,
            "longitude": 0,
            "formatted_address": "100 Main Street, Cary, NC",
            "state": "NC",
        },
    )
    assert bad.status_code == 422

    wrong = client.post(
        "/api/me",
        json={
            "clerk_user_id": "user_wrong_city",
            "name": "Wrong City",
            "email": "w@example.test",
            "initials": "WC",
            "street": "100 Main Street",
            "city": "Cary",
            "latitude": 35.79,
            "longitude": -78.78,
            "formatted_address": "100 Main Street, Durham, NC, United States",
            "state": "NC",
        },
    )
    assert wrong.status_code == 422


def test_unverified_profile_hidden_from_other_residents_list(client):
    client.post(
        "/api/me",
        json={
            "clerk_user_id": "user_hidden",
            "name": "Hidden Neighbor",
            "email": "h@example.test",
            "initials": "HN",
            "street": "22 Maple Street",
            "city": "Charlotte",
        },
    )
    from app.auth import current_actor
    from app.main import app

    app.dependency_overrides[current_actor] = lambda: "avery"
    try:
        rows = client.get("/api/residents").json()
        ids = {row["id"] for row in rows}
        assert "user_hidden" not in ids
        assert "avery" in ids
        # Seeded Charlotte neighbors are verified and stay visible.
        assert "jordan" in ids
    finally:
        app.dependency_overrides.pop(current_actor, None)


def test_patch_about_keeps_verification(client):
    client.post(
        "/api/me",
        json={
            "clerk_user_id": "user_keep",
            "name": "Keep Pin",
            "email": "k@example.test",
            "initials": "KP",
            "street": "100 Main Street",
            "city": "Cary",
            "latitude": 35.7915,
            "longitude": -78.7811,
            "formatted_address": "100 Main Street, Cary, North Carolina, United States",
            "state": "NC",
        },
    )
    patched = client.patch(
        "/api/me",
        json={"clerk_user_id": "user_keep", "about": "Updated bio only"},
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["about"] == "Updated bio only"
    assert body["address_verified"] is True
    assert body["latitude"] == 35.7915


def test_patch_street_without_coords_clears_verification(client):
    client.post(
        "/api/me",
        json={
            "clerk_user_id": "user_clear",
            "name": "Clear Pin",
            "email": "c@example.test",
            "initials": "CP",
            "street": "100 Main Street",
            "city": "Cary",
            "latitude": 35.7915,
            "longitude": -78.7811,
            "formatted_address": "100 Main Street, Cary, North Carolina, United States",
            "state": "NC",
        },
    )
    patched = client.patch(
        "/api/me",
        json={"clerk_user_id": "user_clear", "street": "200 Oak Avenue", "city": "Cary"},
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["street"] == "200 Oak Avenue"
    assert body["address_verified"] is False
    assert body["latitude"] is None
    assert body["verified_at"] is None
