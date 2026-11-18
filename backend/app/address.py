"""Server-side checks for verified profile coordinates."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from app.logic import normalize_city_key
from app.models import Resident

# Contiguous US plus Alaska and Hawaii (same envelope as sample listings).
US_MIN_LAT, US_MAX_LAT = 18.0, 72.0
US_MIN_LNG, US_MAX_LNG = -179.5, -66.0
DEMO_STREET_NEEDLE = "14 willow court"


def is_demo_street(street: str) -> bool:
    return DEMO_STREET_NEEDLE in " ".join((street or "").lower().split())


def inside_us(latitude: float, longitude: float) -> bool:
    return US_MIN_LAT <= latitude <= US_MAX_LAT and US_MIN_LNG <= longitude <= US_MAX_LNG


def is_address_verified(resident: Resident | None) -> bool:
    if resident is None:
        return False
    if resident.verified_at is None:
        return False
    if resident.latitude is None or resident.longitude is None:
        return False
    if resident.latitude == 0 and resident.longitude == 0:
        return False
    return True


def clear_verification(resident: Resident) -> None:
    resident.latitude = None
    resident.longitude = None
    resident.formatted_address = ""
    resident.state = ""
    resident.verified_at = None


def apply_verification(
    resident: Resident,
    *,
    street: str,
    city: str,
    latitude: float | None,
    longitude: float | None,
    formatted_address: str | None,
    state: str | None,
) -> None:
    """Attach verified coords or clear them. Raises 422 when the payload is invalid."""
    if latitude is None and longitude is None and not (formatted_address or state):
        clear_verification(resident)
        if is_demo_street(street):
            # Demo seed street is never treated as verified.
            return
        return

    if latitude is None or longitude is None:
        raise HTTPException(
            status_code=422,
            detail="Verified latitude and longitude are both required.",
        )
    if latitude == 0 and longitude == 0:
        raise HTTPException(status_code=422, detail="Coordinates cannot be 0,0.")
    if not inside_us(float(latitude), float(longitude)):
        raise HTTPException(status_code=422, detail="Coordinates must fall inside the United States.")
    if is_demo_street(street):
        raise HTTPException(
            status_code=422,
            detail="Replace the demo address (14 Willow Court) with your real street.",
        )
    formatted = (formatted_address or "").strip()
    if not formatted:
        raise HTTPException(status_code=422, detail="Formatted address is required when verifying.")
    state_code = (state or "").strip()
    if not state_code:
        raise HTTPException(status_code=422, detail="State is required when verifying.")
    if not _city_appears_in(city, formatted):
        raise HTTPException(
            status_code=422,
            detail="Verified address city does not match the profile city.",
        )

    resident.latitude = float(latitude)
    resident.longitude = float(longitude)
    resident.formatted_address = formatted
    resident.state = state_code
    resident.verified_at = datetime.now(timezone.utc)
    # Keep grid pins in sync for distance helpers that still use x/y.
    resident.x = float(longitude)
    resident.y = float(latitude)


def _city_appears_in(city: str, formatted_address: str) -> bool:
    needle = normalize_city_key(city)
    haystack = normalize_city_key(formatted_address)
    return bool(needle) and needle in haystack
