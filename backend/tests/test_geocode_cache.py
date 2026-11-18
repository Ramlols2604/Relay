"""Server geocode cache, TTL, rate limit, and usage counters."""

from datetime import datetime, timedelta, timezone

from app.geocode_service import (
    GEOCODE_TTL,
    RATE_LIMIT,
    cache_key,
    geocode_center,
    geocode_suggest,
    usage_counts,
)
from app.models import GeocodeCache


def _features_fetcher(features):
    def fetch(_url: str):
        return {"features": features}

    return fetch


CARY_FEATURE = {
    "place_name": "100 Main Street, Cary, North Carolina, United States",
    "center": [-78.7811, 35.7915],
    "place_type": ["address"],
    "relevance": 0.99,
}


def test_geocode_cache_miss_then_hit(client, monkeypatch):
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "pk.test-cache")
    calls = {"n": 0}

    def fetch(_url: str):
        calls["n"] += 1
        return {"features": [CARY_FEATURE]}

    from app.db import session_scope

    with session_scope() as session:
        first = geocode_center(
            session,
            query="100 Main Street, Cary, United States",
            city="Cary",
            actor_id="user_a",
            fetch_mapbox=fetch,
        )
        assert first["cache_hit"] is False
        assert first["latitude"] == 35.7915
        assert calls["n"] >= 1
        mid_calls = calls["n"]

        second = geocode_center(
            session,
            query="100 Main Street, Cary, United States",
            city="Cary",
            actor_id="user_b",
            fetch_mapbox=fetch,
        )
        assert second["cache_hit"] is True
        assert second["longitude"] == -78.7811
        assert calls["n"] == mid_calls  # no new Mapbox traffic
        counts = usage_counts(session)
        assert counts["geocode_calls"] >= 1
        assert counts["geocode_cache_hits"] >= 1


def test_geocode_http_endpoint_and_overview_counters(client, monkeypatch):
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "pk.test-http")

    from app import geocode_service

    def fetch(_url: str):
        return {"features": [CARY_FEATURE]}

    monkeypatch.setattr(geocode_service, "_http_get_json", fetch)

    miss = client.get("/api/geocode", params={"q": "22 Oak Ave, Cary, United States", "city": "Cary"})
    assert miss.status_code == 200, miss.text
    body = miss.json()
    assert body["cache_hit"] is False
    assert body["latitude"] == 35.7915

    hit = client.get("/api/geocode", params={"q": "22 Oak Ave, Cary, United States", "city": "Cary"})
    assert hit.status_code == 200
    assert hit.json()["cache_hit"] is True

    overview = client.get("/api/admin/overview").json()
    assert overview["counts"]["geocode_calls"] >= 1
    assert overview["counts"]["geocode_cache_hits"] >= 1
    assert "mapbox" in overview["integrations"]


def test_geocode_ttl_expiry(client, monkeypatch):
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "pk.test-ttl")
    from app.db import session_scope

    calls = {"n": 0}

    def fetch(_url: str):
        calls["n"] += 1
        return {"features": [CARY_FEATURE]}

    query = "9 Pine Rd, Cary, United States"
    with session_scope() as session:
        geocode_center(session, query=query, city="Cary", actor_id="ttl_user", fetch_mapbox=fetch)
        key = cache_key("center", query, city="Cary")
        row = session.get(GeocodeCache, key)
        assert row is not None
        row.created_at = datetime.now(timezone.utc) - GEOCODE_TTL - timedelta(minutes=1)
        session.add(row)
        session.commit()

        again = geocode_center(session, query=query, city="Cary", actor_id="ttl_user", fetch_mapbox=fetch)
        assert again["cache_hit"] is False
        assert calls["n"] >= 2


def test_geocode_rate_limit_returns_429(client, monkeypatch):
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "pk.test-rate")
    from app.db import session_scope

    def fetch(_url: str):
        return {"features": [CARY_FEATURE]}

    with session_scope() as session:
        # Suggest with a city costs 2 (city proximity + address). Fill the window.
        for index in range(RATE_LIMIT // 2):
            geocode_suggest(
                session,
                query=f"10{index} Rate Street",
                city="Cary",
                actor_id="rate_user",
                fetch_mapbox=fetch,
            )
        try:
            geocode_suggest(
                session,
                query="999 Rate Street",
                city="Cary",
                actor_id="rate_user",
                fetch_mapbox=fetch,
            )
            assert False, "expected 429"
        except Exception as exc:
            assert getattr(exc, "status_code", None) == 429
            assert "hour" in str(exc.detail).lower()


def test_suggest_endpoint_caches_features(client, monkeypatch):
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "pk.test-suggest")
    from app import geocode_service

    monkeypatch.setattr(
        geocode_service,
        "_http_get_json",
        lambda _url: {"features": [CARY_FEATURE]},
    )
    first = client.get(
        "/api/geocode",
        params={"q": "100 Main", "city": "Cary", "autocomplete": True},
    )
    assert first.status_code == 200, first.text
    assert first.json()["cache_hit"] is False
    assert first.json()["features"]
    second = client.get(
        "/api/geocode",
        params={"q": "100 Main", "city": "Cary", "autocomplete": True},
    )
    assert second.json()["cache_hit"] is True


def test_mapbox_token_alias(monkeypatch):
    from app.geocode_service import mapbox_access_token

    monkeypatch.delenv("MAPBOX_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("VITE_MAPBOX_ACCESS_TOKEN", raising=False)
    monkeypatch.setenv("MAPBOX_TOKEN", "pk.alias-only")
    assert mapbox_access_token() == "pk.alias-only"


def test_mapbox_token_ignores_vite_public_token(monkeypatch):
    from app.geocode_service import mapbox_access_token

    monkeypatch.delenv("MAPBOX_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("MAPBOX_TOKEN", raising=False)
    monkeypatch.setenv("VITE_MAPBOX_ACCESS_TOKEN", "pk.public-only")
    assert mapbox_access_token() == ""
