"""Chat ↔ map "closest lender" feature: /api/chat with intent `nearby`."""

import json
from datetime import datetime, timezone

from app.db import session_scope
from app.models import Resident, ShelfItem
from app.sample_listings import replace_sample_listings

CHARLOTTE = (35.2271, -80.8431)
CARY = (35.7915, -78.7811)

FORBIDDEN_SUBSTRINGS = ("email", "phone", "street", "formatted_address")


def _say(client, resident_id, message, **extra):
    response = client.post(
        "/api/chat",
        json={"resident_id": resident_id, "message": message, **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _verify(resident_id: str, lat: float, lng: float, city: str = "Charlotte") -> None:
    with session_scope() as session:
        resident = session.get(Resident, resident_id)
        assert resident is not None, resident_id
        resident.city = city
        resident.latitude = lat
        resident.longitude = lng
        resident.state = "NC"
        resident.formatted_address = f"{resident.street}, {city}, NC"
        resident.verified_at = datetime.now(timezone.utc)
        session.add(resident)
        session.commit()


def _make_resident(
    resident_id: str,
    name: str,
    city: str,
    lat: float,
    lng: float,
) -> None:
    with session_scope() as session:
        session.add(
            Resident(
                id=resident_id,
                name=name,
                short_name=name.split()[0],
                street=f"1 {name.split()[0]} Street",
                initials="".join(part[0] for part in name.split()[:2]).upper(),
                x=0,
                y=0,
                city=city,
                latitude=lat,
                longitude=lng,
                state="NC",
                formatted_address=f"1 {name.split()[0]} Street, {city}, NC",
                verified_at=datetime.now(timezone.utc),
            )
        )
        session.commit()


def _shelf(resident_id: str, catalog_item_id: str, name: str, quantity: int = 1, available: bool = True) -> None:
    with session_scope() as session:
        session.add(
            ShelfItem(
                id=f"{resident_id}:{catalog_item_id}",
                resident_id=resident_id,
                name=name,
                category="tool",
                quantity=quantity,
                condition="Good",
                notes="",
                available_to_lend=available,
                catalog_item_id=catalog_item_id,
            )
        )
        session.commit()


def test_nearby_requires_verified_address(client):
    card = _say(client, "avery", "I want a ladder, who is the closest with it?")
    assert card["type"] == "no_match"
    assert "address" in card["message"].lower()


def test_nearby_orders_by_distance_and_limits_to_three(client):
    _verify("avery", *CHARLOTTE, city="Charlotte")
    # jordan (x2,y1), sam (x3,y3), riley (x5,y2) are close; noor (x40,y0) is same city but far.
    for resident_id in ("jordan", "sam", "riley", "noor"):
        _shelf(resident_id, "drill", "Drill")

    card = _say(client, "avery", "closest drill")
    assert card["type"] == "nearby_lenders"
    assert card["item"] == {"id": "drill", "name": "Drill"}
    assert len(card["lenders"]) == 3
    ids = [row["lender_id"] for row in card["lenders"]]
    assert ids == ["jordan", "sam", "riley"]
    distances = [row["distance_miles"] for row in card["lenders"]]
    assert distances == sorted(distances)
    assert all(row["demo"] is False and row["contact"] is None for row in card["lenders"])


def test_nearby_privacy_never_leaks_contact_fields(client):
    _verify("avery", *CHARLOTTE, city="Charlotte")
    _shelf("jordan", "drill", "Drill")

    card = _say(client, "avery", "who has a drill near me")
    assert card["type"] == "nearby_lenders"
    raw = json.dumps(card).lower()
    for needle in FORBIDDEN_SUBSTRINGS:
        assert needle not in raw, f"{needle!r} leaked into the nearby_lenders payload"
    for lender in card["lenders"]:
        assert lender["contact"] is None
        assert set(lender.keys()) == {
            "inventory_id",
            "lender_id",
            "display_name",
            "distance_miles",
            "item",
            "quantity",
            "condition",
            "max_loan_hours",
            "available_windows",
            "demo",
            "contact",
            "latitude",
            "longitude",
        }


def test_nearby_no_results_suggests_widening(client):
    _verify("avery", *CHARLOTTE, city="Charlotte")
    card = _say(client, "avery", "closest clamps", include_demo_listings=False)
    assert card["type"] == "nearby_lenders"
    assert card["lenders"] == []
    assert "widen" in card["message"].lower() or "demo" in card["message"].lower()


def test_nearby_demo_vs_real_and_combined_ordering(client):
    _verify("avery", *CHARLOTTE, city="Charlotte")
    # Real neighbor farther away.
    _shelf("sam", "drill", "Drill")
    # A closer, deterministic demo listing near Avery.
    with session_scope() as session:
        replace_sample_listings(
            session,
            [
                {
                    "id": "sample:demo-drill",
                    "latitude": CHARLOTTE[0] + 0.0003,
                    "longitude": CHARLOTTE[1] + 0.0003,
                    "city": "Charlotte",
                    "state": "NC",
                    "item": "Drill",
                    "condition": "Excellent",
                    "quantity": 2,
                    "first_name": "Jamie",
                    "last_initial": "D",
                    "max_loan_hours": 5,
                    "is_sample": True,
                }
            ],
        )

    without_demo = _say(client, "avery", "closest drill", include_demo_listings=False)
    assert without_demo["include_demo"] is False
    assert all(row["demo"] is False for row in without_demo["lenders"])
    assert {row["lender_id"] for row in without_demo["lenders"]} == {"sam"}

    with_demo = _say(client, "avery", "closest drill", include_demo_listings=True)
    assert with_demo["include_demo"] is True
    assert len(with_demo["lenders"]) == 2
    nearest = with_demo["lenders"][0]
    assert nearest["demo"] is True
    assert nearest["lender_id"] is None
    assert nearest["display_name"] == "Jamie D."
    assert nearest["max_loan_hours"] == 5
    assert nearest["contact"] is None
    farthest = with_demo["lenders"][1]
    assert farthest["demo"] is False
    assert farthest["lender_id"] == "sam"


def test_nearby_radius_filtering(client):
    _verify("avery", *CARY, city="Cary")
    dlat_1mi = 1.0 / 69.17
    # Different city than Avery, so only the radius decides inclusion.
    _make_resident("near_neighbor", "Near Neighbor", "Apex", CARY[0] + dlat_1mi * 0.5, CARY[1])
    _make_resident("far_neighbor", "Far Neighbor", "Apex", CARY[0] + dlat_1mi * 1.5, CARY[1])
    _shelf("near_neighbor", "drill", "Drill")
    _shelf("far_neighbor", "drill", "Drill")

    card = _say(client, "avery", "closest drill", radius_miles=1.0, include_demo_listings=False)
    assert card["radius_miles"] == 1.0
    ids = {row["lender_id"] for row in card["lenders"]}
    assert ids == {"near_neighbor"}


def test_nearby_ignores_items_not_willing_to_lend_or_out_of_stock(client):
    _verify("avery", *CHARLOTTE, city="Charlotte")
    _shelf("jordan", "drill", "Drill", available=False)
    _shelf("sam", "drill", "Drill", quantity=0)

    card = _say(client, "avery", "closest drill", include_demo_listings=False)
    assert card["type"] == "nearby_lenders"
    assert card["lenders"] == []
