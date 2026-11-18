"""Haversine radius filtering for GET /api/listings."""

from app.db import session_scope
from app.sample_listings import (
    bbox_for_radius,
    haversine_miles,
    listings_near,
    replace_sample_listings,
)

# Cary, NC
ORIGIN = (35.7915, -78.7811)


def test_haversine_known_distances():
    # 1° latitude ≈ 69.17 miles
    one_deg = haversine_miles(35.0, -78.0, 36.0, -78.0)
    assert 68.5 < one_deg < 69.8
    # Same point
    assert haversine_miles(*ORIGIN, *ORIGIN) == 0.0
    # Cary → Raleigh (about 8 miles)
    raleigh = (35.7796, -78.6382)
    miles = haversine_miles(*ORIGIN, *raleigh)
    assert 7.5 < miles < 9.0


def test_boundary_inclusion_and_nearest_ordering(client):
    # Plant three pins: inside, on the edge (~2 mi north), and just outside.
    # 2 miles ≈ 2/69.17 ≈ 0.0289° latitude.
    dlat_2mi = 2.0 / 69.17
    rows = [
        {
            "id": "sample:near",
            "latitude": ORIGIN[0] + 0.005,
            "longitude": ORIGIN[1],
            "city": "Cary",
            "state": "NC",
            "item": "Ladder",
            "condition": "Good",
            "quantity": 1,
            "is_sample": True,
        },
        {
            "id": "sample:edge",
            "latitude": ORIGIN[0] + dlat_2mi * 0.99,
            "longitude": ORIGIN[1],
            "city": "Cary",
            "state": "NC",
            "item": "Saw",
            "condition": "Good",
            "quantity": 1,
            "is_sample": True,
        },
        {
            "id": "sample:out",
            "latitude": ORIGIN[0] + dlat_2mi * 1.15,
            "longitude": ORIGIN[1],
            "city": "Cary",
            "state": "NC",
            "item": "Drill",
            "condition": "Good",
            "quantity": 1,
            "is_sample": True,
        },
        {
            "id": "sample:farther-inside",
            "latitude": ORIGIN[0] + 0.02,
            "longitude": ORIGIN[1],
            "city": "Cary",
            "state": "NC",
            "item": "Hose",
            "condition": "Fair",
            "quantity": 1,
            "is_sample": True,
        },
    ]
    with session_scope() as session:
        replace_sample_listings(session, rows)
        found = listings_near(session, ORIGIN[0], ORIGIN[1], radius_miles=2.0, limit=2000)
        ids = [row["id"] for row in found]
        assert "sample:near" in ids
        assert "sample:edge" in ids
        assert "sample:farther-inside" in ids
        assert "sample:out" not in ids
        # Nearest first
        distances = [row["distance_miles"] for row in found]
        assert distances == sorted(distances)
        assert found[0]["id"] == "sample:near"

    response = client.get(
        "/api/listings",
        params={"radius_miles": 2, "lat": ORIGIN[0], "lng": ORIGIN[1], "limit": 2000},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["radius_miles"] == 2
    assert body["count"] == len(body["items"])
    assert all(row["distance_miles"] <= 2.0 + 1e-6 for row in body["items"])
    assert [row["id"] for row in body["items"]] == ids


def test_bbox_prefilter_contains_the_circle():
    west, south, east, north = bbox_for_radius(*ORIGIN, 5)
    # A point on the circle due east must sit inside the bbox.
    # 5 miles east ≈ 5/(69.17*cos(lat)) degrees
    import math

    dlng = 5.0 / (69.17 * math.cos(math.radians(ORIGIN[0])))
    edge_lng = ORIGIN[1] + dlng * 0.99
    assert west <= edge_lng <= east
    assert south <= ORIGIN[0] <= north


def test_listings_radius_validation(client):
    assert (
        client.get("/api/listings", params={"radius_miles": 2, "lat": 35.0}).status_code == 400
    )
    assert (
        client.get(
            "/api/listings",
            params={"radius_miles": 100, "lat": 35.0, "lng": -78.0},
        ).status_code
        == 400
    )
