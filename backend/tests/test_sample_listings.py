"""Sample/demo listings: reproducible generation, US bounds, density, bbox, no matching."""

import string
from pathlib import Path

from app.db import session_scope
from app.sample_listings import (
    BOOTSTRAP_COUNT,
    BOOTSTRAP_PLACES,
    CLUSTER_PER_CITY,
    FIRST_NAMES,
    LAST_INITIALS,
    TARGET_COUNT,
    generate_listings,
    inside_us,
    listings_in_bbox,
    listings_near,
    parse_places_file,
    replace_sample_listings,
    resolve_places,
    sample_listing_count,
)

FIX = Path(__file__).parent / "fixtures"

# Real coordinates (match the entries baked into BOOTSTRAP_PLACES).
CARY_NC = (35.7915, -78.7811)
RALEIGH_NC = (35.7796, -78.6382)
CHICAGO_IL = (41.8781, -87.6298)
MIN_WITHIN_2_MILES = 10


def test_target_count_is_100k_everywhere():
    assert TARGET_COUNT == 100_000
    assert BOOTSTRAP_COUNT < TARGET_COUNT


def test_seeded_generation_is_reproducible():
    places = parse_places_file(FIX / "us_places_tiny.csv")
    first = generate_listings(places, count=200, seed=42)
    second = generate_listings(places, count=200, seed=42)
    assert first == second
    assert len(first) == 200
    assert all(row["is_sample"] is True for row in first)
    assert all(row["id"].startswith("sample:") for row in first)


def test_different_seeds_change_output():
    places = parse_places_file(FIX / "us_places_tiny.csv")
    a = generate_listings(places, count=50, seed=1)
    b = generate_listings(places, count=50, seed=2)
    assert a != b


def test_no_row_falls_outside_the_us():
    places = parse_places_file(FIX / "cities15000_tiny.txt")
    # Paris (FR) must be ignored; Honolulu (HI) stays.
    assert all(place.name != "Paris" for place in places)
    assert any(place.name == "Honolulu" for place in places)
    rows = generate_listings(places, count=500, seed=42)
    for row in rows:
        assert inside_us(row["latitude"], row["longitude"]), row


def test_geonames_and_simplemaps_parsers(client):
    geo = parse_places_file(FIX / "cities15000_tiny.txt")
    csv_places = parse_places_file(FIX / "us_places_tiny.csv")
    assert len(geo) >= 4
    assert len(csv_places) >= 4


def test_every_row_has_generated_person_item_and_loan_hours():
    places = parse_places_file(FIX / "us_places_tiny.csv")
    rows = generate_listings(places, count=300, seed=42)
    first_name_pool = set(FIRST_NAMES)
    last_initial_pool = set(LAST_INITIALS)
    assert first_name_pool  # ~40 common US first names
    assert last_initial_pool == set(string.ascii_uppercase)
    for row in rows:
        assert row["is_sample"] is True
        assert row["first_name"] in first_name_pool
        assert row["last_initial"] in last_initial_pool
        assert 1 <= row["quantity"] <= 5
        assert row["condition"] in ("Excellent", "Good", "Fair")
        assert row["item"]
        assert isinstance(row["max_loan_hours"], int)
        assert row["max_loan_hours"] > 0


def test_bbox_query_only_returns_rows_inside_and_respects_limit(client):
    places = parse_places_file(FIX / "us_places_tiny.csv")
    rows = generate_listings(places, count=80, seed=7)
    with session_scope() as session:
        replace_sample_listings(session, rows)
        # North Carolina / mid-Atlantic slice — Cary and Charlotte sit here.
        inside = listings_in_bbox(session, -81.5, 34.5, -77.5, 36.5, limit=2000)
        assert inside
        assert all(-81.5 <= row["longitude"] <= -77.5 for row in inside)
        assert all(34.5 <= row["latitude"] <= 36.5 for row in inside)
        capped = listings_in_bbox(session, -180, 0, 0, 90, limit=5)
        assert len(capped) == 5


def test_api_listings_bbox_and_limit(client):
    places = parse_places_file(FIX / "us_places_tiny.csv")
    rows = generate_listings(places, count=40, seed=3)
    with session_scope() as session:
        replace_sample_listings(session, rows)

    bad = client.get("/api/listings", params={"bbox": "1,2,3"})
    assert bad.status_code == 400

    response = client.get(
        "/api/listings",
        params={"bbox": "-81.5,34.5,-77.5,36.5", "limit": 10},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_sample"] is True
    assert body["count"] == len(body["items"])
    assert body["count"] <= 10
    for item in body["items"]:
        assert item["is_sample"] is True
        assert -81.5 <= item["longitude"] <= -77.5
        assert 34.5 <= item["latitude"] <= 36.5
        assert "first_name" in item
        assert "last_initial" in item
        assert "max_loan_hours" in item


def test_sample_rows_are_excluded_from_matching(client):
    places = parse_places_file(FIX / "us_places_tiny.csv")
    rows = generate_listings(places, count=20, seed=9)
    with session_scope() as session:
        replace_sample_listings(session, rows)
        sample_id = rows[0]["id"]

    inventory = client.get("/api/inventory").json()
    ids = {item.get("inventory_id") for item in inventory["items"]}
    assert sample_id not in ids

    neighborhood = client.get("/api/neighborhood", params={"resident_id": "avery"}).json()
    neighbor_ids = {item.get("inventory_id") for item in neighborhood["items"]}
    assert sample_id not in neighbor_ids

    loan = client.post(
        "/api/loans",
        json={
            "borrower_id": "avery",
            "lender_id": "jordan",
            "catalog_item_id": "drill",
            "inventory_id": sample_id,
            "window_start": "2030-01-02T10:00:00",
            "window_end": "2030-01-02T12:00:00",
            "quantity": 1,
        },
    )
    assert loan.status_code == 400
    assert "Sample" in loan.json()["detail"]


def test_ensure_sample_listings_seeds_bootstrap_count_once_when_empty(client):
    from app.sample_listings import ensure_sample_listings

    with session_scope() as session:
        # Lifespan may have bootstrapped samples already; start from empty.
        replace_sample_listings(session, [])
        assert sample_listing_count(session) == 0
        first = ensure_sample_listings(session, count=50)
        assert first == 50
        assert sample_listing_count(session) == 50


def test_ensure_sample_listings_tops_up_when_below_requested_count(client):
    """Startup tops up a thin table to the requested bootstrap floor, not TARGET_COUNT."""
    from app.sample_listings import ensure_sample_listings

    with session_scope() as session:
        replace_sample_listings(
            session,
            [
                {
                    "id": "sample:000000",
                    "latitude": CARY_NC[0],
                    "longitude": CARY_NC[1],
                    "city": "Cary",
                    "state": "NC",
                    "item": "Ladder",
                    "condition": "Good",
                    "quantity": 1,
                    "first_name": "Jordan",
                    "last_initial": "L",
                    "max_loan_hours": 4,
                    "is_sample": True,
                }
            ],
        )
        assert sample_listing_count(session) == 1
        written = ensure_sample_listings(session, count=50)
        assert written == 50
        assert sample_listing_count(session) == 50
        # Already at the floor — leave alone (never expands to TARGET_COUNT here).
        assert ensure_sample_listings(session, count=50) == 0
        assert sample_listing_count(session) == 50


def test_sample_ids_never_appear_in_admin_people(client):
    # Even if a sample-prefixed resident snuck into the table, admin must hide it.
    from app.models import Resident

    with session_scope() as session:
        session.add(
            Resident(
                id="sample:ghost",
                name="Ghost Sample",
                short_name="Ghost",
                street="1 Nowhere",
                initials="GS",
                x=0,
                y=0,
                city="Cary",
            )
        )
        session.commit()

    people = client.get("/api/admin/residents").json()
    assert all(not str(row["id"]).startswith("sample:") for row in people)


def test_top_cities_get_dense_clusters_within_two_miles():
    """A default 2-mile radius search must never be empty in a big, clustered city."""
    places = resolve_places()
    assert len(places) >= 3  # the bootstrap nationwide list, since no data file is downloaded

    rows = generate_listings(places, count=TARGET_COUNT, seed=42)
    assert len(rows) == TARGET_COUNT
    assert all(row["is_sample"] is True for row in rows)

    with session_scope() as session:
        replace_sample_listings(session, rows)

        for lat, lng in (CARY_NC, RALEIGH_NC, CHICAGO_IL):
            found = listings_near(session, lat, lng, radius_miles=2.0, limit=2000)
            assert len(found) >= MIN_WITHIN_2_MILES, (lat, lng, len(found))
            assert all(item["distance_miles"] <= 2.0 + 1e-6 for item in found)


def test_cluster_per_city_constant_is_reasonable():
    # "~30" per the top cities, per the density requirement.
    assert 20 <= CLUSTER_PER_CITY <= 40


def test_bootstrap_places_cover_cary_raleigh_and_chicago():
    names = {(place.name, place.state) for place in BOOTSTRAP_PLACES}
    assert ("Cary", "NC") in names
    assert ("Raleigh", "NC") in names
    assert ("Chicago", "IL") in names
