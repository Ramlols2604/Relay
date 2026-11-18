"""Shared Mapbox geocoding with SQLite cache, usage counters, and per-user rate limits."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from sqlmodel import Session, select

from app.models import GeocodeCache, GeocodeRateWindow, UsageCounter

GEOCODE_TTL = timedelta(days=30)
RATE_LIMIT = 30
RATE_WINDOW = timedelta(hours=1)
FALLBACK_PROXIMITY = (-78.8986, 35.9940)  # Triangle bias
COUNTER_CALLS = "geocode_calls"
COUNTER_HITS = "geocode_cache_hits"

MapboxFetcher = Callable[[str], dict[str, Any]]


def mapbox_access_token() -> str:
    # Server-only tokens. Do not fall back to VITE_MAPBOX_ACCESS_TOKEN — that public
    # browser token is meant for Map GL URL restrictions, not geocoding quota.
    for key in ("MAPBOX_ACCESS_TOKEN", "MAPBOX_TOKEN"):
        value = os.environ.get(key, "").strip()
        if value:
            return value
    return ""


def normalize_query(query: str) -> str:
    return re.sub(r"\s+", " ", (query or "").strip().lower())


def cache_key(kind: str, query: str, *, city: str = "", types: str = "") -> str:
    parts = [kind, normalize_query(query)]
    if city:
        parts.append(f"city={normalize_query(city)}")
    if types:
        parts.append(f"types={types.strip().lower()}")
    return "|".join(parts)


def usage_counts(session: Session) -> dict[str, int]:
    return {
        "geocode_calls": _counter_value(session, COUNTER_CALLS),
        "geocode_cache_hits": _counter_value(session, COUNTER_HITS),
    }


def geocode_center(
    session: Session,
    *,
    query: str,
    actor_id: str,
    city: str = "",
    fetch_mapbox: MapboxFetcher | None = None,
) -> dict[str, Any]:
    """Resolve a street/city query to a single center. Cache hit skips Mapbox."""
    q = " ".join((query or "").split())
    if not q:
        raise HTTPException(status_code=422, detail="Query q is required.")
    key = cache_key("center", q, city=city)
    cached = _get_fresh(session, key)
    if cached is not None:
        _bump(session, COUNTER_HITS)
        session.commit()
        return {**cached, "cache_hit": True}

    token = mapbox_access_token()
    if not token and fetch_mapbox is None:
        raise HTTPException(
            status_code=503,
            detail="Mapbox is not configured on the API. Set MAPBOX_ACCESS_TOKEN.",
        )

    _consume_rate(session, actor_id, cost=2 if city.strip() else 1)
    fetch = fetch_mapbox or (lambda url: _http_get_json(url))

    city_center = None
    if city.strip():
        city_features = _mapbox_features(
            fetch,
            token,
            f"{city.strip()}, United States",
            types="place,locality",
            proximity=FALLBACK_PROXIMITY,
        )
        city_center = _pick_center(city_features, city) or None
        _bump(session, COUNTER_CALLS)

    proximity = (
        (city_center["longitude"], city_center["latitude"]) if city_center else FALLBACK_PROXIMITY
    )
    features = _mapbox_features(
        fetch,
        token,
        q,
        types="address,place,locality,neighborhood",
        proximity=proximity,
    )
    _bump(session, COUNTER_CALLS)
    best = _pick_center(features, city)
    if best and city_center and not _roughly_near(best, city_center, 40):
        # Street matched elsewhere — stay on the named city.
        center = city_center
    elif best and city.strip() and city.strip().lower() not in (best.get("label") or "").lower():
        center = city_center or best
    else:
        center = best or city_center

    if center is None:
        raise HTTPException(status_code=404, detail="No geocode result for that address.")

    payload = {
        "longitude": center["longitude"],
        "latitude": center["latitude"],
        "label": center["label"],
    }
    _store(session, key, payload)
    session.commit()
    return {**payload, "cache_hit": False}


def geocode_suggest(
    session: Session,
    *,
    query: str,
    city: str,
    actor_id: str,
    limit: int = 5,
    fetch_mapbox: MapboxFetcher | None = None,
) -> dict[str, Any]:
    """Forward-geocode address suggestions (autocomplete). Cached per query+city."""
    q = " ".join((query or "").split())
    if len(q) < 4:
        return {"features": [], "cache_hit": True}
    search = ", ".join(part for part in (q, city.strip(), "United States") if part)
    key = cache_key("suggest", search, city=city, types="address")
    cached = _get_fresh(session, key)
    if cached is not None:
        _bump(session, COUNTER_HITS)
        session.commit()
        return {**cached, "cache_hit": True}

    token = mapbox_access_token()
    if not token and fetch_mapbox is None:
        raise HTTPException(
            status_code=503,
            detail="Mapbox is not configured on the API. Set MAPBOX_ACCESS_TOKEN.",
        )

    _consume_rate(session, actor_id, cost=1)
    fetch = fetch_mapbox or (lambda url: _http_get_json(url))
    features = _mapbox_features(
        fetch,
        token,
        search,
        types="address",
        proximity=FALLBACK_PROXIMITY,
        limit=limit,
        autocomplete=True,
    )
    _bump(session, COUNTER_CALLS)
    payload = {"features": features}
    _store(session, key, payload)
    session.commit()
    return {**payload, "cache_hit": False}


def _get_fresh(session: Session, key: str) -> dict[str, Any] | None:
    row = session.get(GeocodeCache, key)
    if row is None:
        return None
    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - created > GEOCODE_TTL:
        session.delete(row)
        session.commit()
        return None
    try:
        data = json.loads(row.result_json)
    except json.JSONDecodeError:
        session.delete(row)
        session.commit()
        return None
    return data if isinstance(data, dict) else None


def _store(session: Session, key: str, payload: dict[str, Any]) -> None:
    row = session.get(GeocodeCache, key)
    now = datetime.now(timezone.utc)
    body = json.dumps(payload)
    if row is None:
        session.add(GeocodeCache(query_key=key, result_json=body, created_at=now))
    else:
        row.result_json = body
        row.created_at = now
        session.add(row)


def _consume_rate(session: Session, actor_id: str, *, cost: int) -> None:
    now = datetime.now(timezone.utc)
    bucket = session.get(GeocodeRateWindow, actor_id)
    if bucket is None:
        session.add(GeocodeRateWindow(actor_id=actor_id, window_start=now, count=cost))
        return
    start = bucket.window_start
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if now - start >= RATE_WINDOW:
        bucket.window_start = now
        bucket.count = cost
        session.add(bucket)
        return
    if bucket.count + cost > RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Geocode limit reached for this hour. Try again later, or reuse a saved address.",
        )
    bucket.count += cost
    session.add(bucket)


def _bump(session: Session, name: str, amount: int = 1) -> None:
    row = session.get(UsageCounter, name)
    if row is None:
        session.add(UsageCounter(name=name, value=amount))
    else:
        row.value += amount
        session.add(row)


def _counter_value(session: Session, name: str) -> int:
    row = session.get(UsageCounter, name)
    return int(row.value) if row else 0


def _http_get_json(url: str) -> dict[str, Any]:
    # Stub token used by Playwright flows — never hit the real API.
    if "access_token=pk.flow-test" in url or mapbox_access_token() == "pk.flow-test":
        return _stub_response(url)
    response = httpx.get(url, timeout=8.0)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Mapbox geocode request failed.")
    return response.json()


def _stub_response(url: str) -> dict[str, Any]:
    from urllib.parse import unquote

    decoded = unquote(url).lower()
    if "willow" in decoded or "approximate" in decoded:
        return {
            "features": [
                {
                    "id": "place.approx",
                    "place_type": ["place"],
                    "relevance": 0.6,
                    "place_name": "Willow Court area, Cary, North Carolina",
                    "text": "Cary",
                    "center": [-78.78, 35.79],
                    "context": [],
                }
            ]
        }
    if "100 main" in decoded or "main street" in decoded or "oak ave" in decoded or "pine rd" in decoded or "rate street" in decoded:
        return {
            "features": [
                {
                    "id": "address.100main",
                    "place_type": ["address"],
                    "relevance": 0.98,
                    "place_name": "100 Main Street, Cary, North Carolina 27513, United States",
                    "text": "Main Street",
                    "address": "100",
                    "center": [-78.7811, 35.7915],
                    "context": [
                        {"id": "place.cary", "text": "Cary"},
                        {"id": "region.nc", "text": "North Carolina", "short_code": "US-NC"},
                    ],
                }
            ]
        }
    return {"features": []}


def _mapbox_features(
    fetch: MapboxFetcher,
    token: str,
    query: str,
    *,
    types: str,
    proximity: tuple[float, float],
    limit: int = 5,
    autocomplete: bool = False,
) -> list[dict[str, Any]]:
    lng, lat = proximity
    url = (
        f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(query)}.json"
        f"?access_token={token}&limit={limit}&types={types}&country=us"
        f"&proximity={lng},{lat}"
    )
    if autocomplete:
        url += "&autocomplete=true"
    body = fetch(url)
    features = body.get("features") if isinstance(body, dict) else None
    return list(features) if isinstance(features, list) else []


def _pick_center(features: list[dict[str, Any]], city: str) -> dict[str, Any] | None:
    if not features:
        return None
    needle = city.strip().lower()
    ordered = features
    if needle:
        scored = []
        for index, feature in enumerate(features):
            label = str(feature.get("place_name") or "").lower()
            in_city = 0 if needle in label else 1
            nc = 0 if re.search(r"north carolina|\bnc\b", label) else 1
            scored.append((in_city * 10 + nc * 5 + index, feature))
        scored.sort(key=lambda row: row[0])
        ordered = [row[1] for row in scored]
    for feature in ordered:
        center = feature.get("center")
        if not isinstance(center, (list, tuple)) or len(center) < 2:
            continue
        lng, lat = float(center[0]), float(center[1])
        if not (lng or lat):
            continue
        return {
            "longitude": lng,
            "latitude": lat,
            "label": str(feature.get("place_name") or "").strip() or "Unknown",
        }
    return None


def _roughly_near(a: dict[str, Any], b: dict[str, Any], max_km: float) -> bool:
    from math import asin, cos, radians, sin, sqrt

    d_lat = radians(b["latitude"] - a["latitude"])
    d_lng = radians(b["longitude"] - a["longitude"])
    lat1 = radians(a["latitude"])
    lat2 = radians(b["latitude"])
    h = sin(d_lat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(d_lng / 2) ** 2
    km = 2 * 6371 * asin(min(1.0, sqrt(h)))
    return km <= max_km


def purge_expired(session: Session) -> int:
    """Delete cache rows older than TTL. Returns how many were removed."""
    cutoff = datetime.now(timezone.utc) - GEOCODE_TTL
    rows = session.exec(select(GeocodeCache)).all()
    removed = 0
    for row in rows:
        created = row.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created < cutoff:
            session.delete(row)
            removed += 1
    if removed:
        session.commit()
    return removed
