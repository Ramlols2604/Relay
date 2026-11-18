"""Generate and query sample listings on real US cities (never for real loans)."""

from __future__ import annotations

import csv
import math
import random
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete, func
from sqlmodel import Session, select

from app.models import SampleListing
from app.seed import CATALOG

SEED = 42
# Full nationwide dataset, built offline by scripts/build_sample_listings.py.
TARGET_COUNT = 100_000
# Startup seed when the table is empty or still below this floor. Kept under
# TARGET_COUNT so boot stays reasonable; run the build script for the full set.
BOOTSTRAP_COUNT = 25_000
CONDITIONS = ("Excellent", "Good", "Fair")
DEFAULT_LOAN_HOURS = 4
# Dense local clusters so a default 2-mile radius search is never empty in a big city.
CLUSTER_CITY_LIMIT = 200
CLUSTER_PER_CITY = 30
CLUSTER_MIN_MILES = 0.1
CLUSTER_MAX_MILES = 3.0
# ~40 common US first names, paired with a random last-initial A-Z for generated listings.
FIRST_NAMES: tuple[str, ...] = (
    "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
    "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
    "Thomas", "Sarah", "Charles", "Karen", "Christopher", "Nancy", "Daniel", "Lisa",
    "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley",
    "Steven", "Kimberly", "Paul", "Emily", "Andrew", "Donna", "Joshua", "Michelle",
)
LAST_INITIALS: tuple[str, ...] = tuple("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
# Contiguous US plus Alaska and Hawaii.
US_MIN_LAT, US_MAX_LAT = 18.0, 72.0
US_MIN_LNG, US_MAX_LNG = -179.5, -66.0
SAMPLE_ID_PREFIX = "sample:"
DEFAULT_PLACES_CANDIDATES = (
    Path(__file__).resolve().parent.parent / "data" / "cities15000.txt",
    Path(__file__).resolve().parent.parent / "data" / "uscities.csv",
)


@dataclass(frozen=True)
class Place:
    name: str
    state: str
    latitude: float
    longitude: float
    population: int


# Real US city centers used when the downloaded places file is not present yet.
# Populations are approximate census figures used only for weighting.
BOOTSTRAP_PLACES: tuple[Place, ...] = (
    Place("New York", "NY", 40.7128, -74.0060, 8_300_000),
    Place("Los Angeles", "CA", 34.0522, -118.2437, 3_900_000),
    Place("Chicago", "IL", 41.8781, -87.6298, 2_700_000),
    Place("Houston", "TX", 29.7604, -95.3698, 2_300_000),
    Place("Phoenix", "AZ", 33.4484, -112.0740, 1_600_000),
    Place("Philadelphia", "PA", 39.9526, -75.1652, 1_600_000),
    Place("San Antonio", "TX", 29.4241, -98.4936, 1_400_000),
    Place("San Diego", "CA", 32.7157, -117.1611, 1_400_000),
    Place("Dallas", "TX", 32.7767, -96.7970, 1_300_000),
    Place("San Jose", "CA", 37.3382, -121.8863, 1_000_000),
    Place("Austin", "TX", 30.2672, -97.7431, 960_000),
    Place("Jacksonville", "FL", 30.3322, -81.6557, 950_000),
    Place("Fort Worth", "TX", 32.7555, -97.3308, 920_000),
    Place("Columbus", "OH", 39.9612, -82.9988, 900_000),
    Place("Charlotte", "NC", 35.2271, -80.8431, 900_000),
    Place("Indianapolis", "IN", 39.7684, -86.1581, 880_000),
    Place("San Francisco", "CA", 37.7749, -122.4194, 870_000),
    Place("Seattle", "WA", 47.6062, -122.3321, 750_000),
    Place("Denver", "CO", 39.7392, -104.9903, 710_000),
    Place("Washington", "DC", 38.9072, -77.0369, 690_000),
    Place("Boston", "MA", 42.3601, -71.0589, 675_000),
    Place("El Paso", "TX", 31.7619, -106.4850, 680_000),
    Place("Nashville", "TN", 36.1627, -86.7816, 680_000),
    Place("Detroit", "MI", 42.3314, -83.0458, 640_000),
    Place("Oklahoma City", "OK", 35.4676, -97.5164, 680_000),
    Place("Portland", "OR", 45.5152, -122.6784, 650_000),
    Place("Las Vegas", "NV", 36.1699, -115.1398, 650_000),
    Place("Memphis", "TN", 35.1495, -90.0490, 630_000),
    Place("Louisville", "KY", 38.2527, -85.7585, 630_000),
    Place("Baltimore", "MD", 39.2904, -76.6122, 580_000),
    Place("Milwaukee", "WI", 43.0389, -87.9065, 570_000),
    Place("Albuquerque", "NM", 35.0844, -106.6504, 560_000),
    Place("Tucson", "AZ", 32.2226, -110.9747, 540_000),
    Place("Fresno", "CA", 36.7378, -119.7871, 540_000),
    Place("Sacramento", "CA", 38.5816, -121.4944, 520_000),
    Place("Mesa", "AZ", 33.4152, -111.8315, 510_000),
    Place("Kansas City", "MO", 39.0997, -94.5786, 510_000),
    Place("Atlanta", "GA", 33.7490, -84.3880, 500_000),
    Place("Omaha", "NE", 41.2565, -95.9345, 490_000),
    Place("Colorado Springs", "CO", 38.8339, -104.8214, 480_000),
    Place("Raleigh", "NC", 35.7796, -78.6382, 470_000),
    Place("Miami", "FL", 25.7617, -80.1918, 440_000),
    Place("Long Beach", "CA", 33.7701, -118.1937, 460_000),
    Place("Virginia Beach", "VA", 36.8529, -75.9780, 460_000),
    Place("Oakland", "CA", 37.8044, -122.2712, 440_000),
    Place("Minneapolis", "MN", 44.9778, -93.2650, 430_000),
    Place("Tulsa", "OK", 36.1540, -95.9928, 410_000),
    Place("Tampa", "FL", 27.9506, -82.4572, 400_000),
    Place("New Orleans", "LA", 29.9511, -90.0715, 380_000),
    Place("Cleveland", "OH", 41.4993, -81.6944, 370_000),
    Place("Wichita", "KS", 37.6872, -97.3301, 390_000),
    Place("Arlington", "TX", 32.7357, -97.1081, 390_000),
    Place("Bakersfield", "CA", 35.3733, -119.0187, 400_000),
    Place("Aurora", "CO", 39.7294, -104.8319, 380_000),
    Place("Anaheim", "CA", 33.8366, -117.9143, 340_000),
    Place("Honolulu", "HI", 21.3069, -157.8583, 340_000),
    Place("Santa Ana", "CA", 33.7455, -117.8677, 310_000),
    Place("Riverside", "CA", 33.9806, -117.3755, 310_000),
    Place("Corpus Christi", "TX", 27.8006, -97.3964, 320_000),
    Place("Lexington", "KY", 38.0406, -84.5037, 320_000),
    Place("Henderson", "NV", 36.0395, -114.9817, 320_000),
    Place("Stockton", "CA", 37.9577, -121.2908, 310_000),
    Place("Saint Paul", "MN", 44.9537, -93.0900, 300_000),
    Place("Cincinnati", "OH", 39.1031, -84.5120, 310_000),
    Place("St. Louis", "MO", 38.6270, -90.1994, 290_000),
    Place("Pittsburgh", "PA", 40.4406, -79.9959, 300_000),
    Place("Greensboro", "NC", 36.0726, -79.7920, 300_000),
    Place("Anchorage", "AK", 61.2181, -149.9003, 290_000),
    Place("Plano", "TX", 33.0198, -96.6989, 290_000),
    Place("Lincoln", "NE", 40.8136, -96.7026, 290_000),
    Place("Orlando", "FL", 28.5383, -81.3792, 310_000),
    Place("Irvine", "CA", 33.6846, -117.8265, 310_000),
    Place("Newark", "NJ", 40.7357, -74.1724, 310_000),
    Place("Durham", "NC", 35.9940, -78.8986, 280_000),
    Place("Chula Vista", "CA", 32.6401, -117.0842, 280_000),
    Place("Toledo", "OH", 41.6528, -83.5379, 270_000),
    Place("Fort Wayne", "IN", 41.0793, -85.1394, 270_000),
    Place("St. Petersburg", "FL", 27.7676, -82.6403, 260_000),
    Place("Laredo", "TX", 27.5306, -99.4803, 260_000),
    Place("Jersey City", "NJ", 40.7178, -74.0431, 290_000),
    Place("Chandler", "AZ", 33.3062, -111.8413, 280_000),
    Place("Madison", "WI", 43.0731, -89.4012, 270_000),
    Place("Lubbock", "TX", 33.5779, -101.8552, 260_000),
    Place("Scottsdale", "AZ", 33.4942, -111.9261, 250_000),
    Place("Reno", "NV", 39.5296, -119.8138, 270_000),
    Place("Buffalo", "NY", 42.8864, -78.8784, 270_000),
    Place("Gilbert", "AZ", 33.3528, -111.7890, 270_000),
    Place("Glendale", "AZ", 33.5387, -112.1860, 250_000),
    Place("North Las Vegas", "NV", 36.1989, -115.1175, 270_000),
    Place("Winston-Salem", "NC", 36.0999, -80.2442, 250_000),
    Place("Chesapeake", "VA", 36.7682, -76.2875, 250_000),
    Place("Norfolk", "VA", 36.8508, -76.2859, 240_000),
    Place("Fremont", "CA", 37.5485, -121.9886, 230_000),
    Place("Garland", "TX", 32.9126, -96.6389, 240_000),
    Place("Irving", "TX", 32.8140, -96.9489, 250_000),
    Place("Hialeah", "FL", 25.8576, -80.2781, 220_000),
    Place("Richmond", "VA", 37.5407, -77.4360, 230_000),
    Place("Boise", "ID", 43.6150, -116.2023, 240_000),
    Place("Spokane", "WA", 47.6588, -117.4260, 230_000),
    Place("Baton Rouge", "LA", 30.4515, -91.1871, 220_000),
    Place("Tacoma", "WA", 47.2529, -122.4443, 220_000),
    Place("San Bernardino", "CA", 34.1083, -117.2898, 220_000),
    Place("Modesto", "CA", 37.6391, -120.9969, 220_000),
    Place("Fontana", "CA", 34.0922, -117.4350, 210_000),
    Place("Des Moines", "IA", 41.5868, -93.6250, 210_000),
    Place("Moreno Valley", "CA", 33.9425, -117.2297, 210_000),
    Place("Santa Clarita", "CA", 34.3917, -118.5426, 230_000),
    Place("Fayetteville", "NC", 35.0527, -78.8784, 210_000),
    Place("Birmingham", "AL", 33.5186, -86.8104, 200_000),
    Place("Rochester", "NY", 43.1566, -77.6088, 210_000),
    Place("Oxnard", "CA", 34.1975, -119.1771, 200_000),
    Place("Port St. Lucie", "FL", 27.2730, -80.3582, 220_000),
    Place("Grand Rapids", "MI", 42.9634, -85.6681, 200_000),
    Place("Huntsville", "AL", 34.7304, -86.5861, 220_000),
    Place("Salt Lake City", "UT", 40.7608, -111.8910, 200_000),
    Place("Frisco", "TX", 33.1507, -96.8236, 220_000),
    Place("Yonkers", "NY", 40.9312, -73.8987, 210_000),
    Place("Amarillo", "TX", 35.2220, -101.8313, 200_000),
    Place("Glendale", "CA", 34.1425, -118.2551, 190_000),
    Place("Huntington Beach", "CA", 33.6595, -117.9988, 190_000),
    Place("McKinney", "TX", 33.1972, -96.6397, 210_000),
    Place("Montgomery", "AL", 32.3792, -86.3077, 200_000),
    Place("Augusta", "GA", 33.4735, -82.0105, 200_000),
    Place("Akron", "OH", 41.0814, -81.5190, 190_000),
    Place("Little Rock", "AR", 34.7465, -92.2896, 200_000),
    Place("Overland Park", "KS", 38.9822, -94.6708, 200_000),
    Place("Grand Prairie", "TX", 32.7460, -96.9978, 200_000),
    Place("Tallahassee", "FL", 30.4383, -84.2807, 200_000),
    Place("Cape Coral", "FL", 26.5629, -81.9495, 210_000),
    Place("Mobile", "AL", 30.6954, -88.0399, 180_000),
    Place("Knoxville", "TN", 35.9606, -83.9207, 190_000),
    Place("Shreveport", "LA", 32.5252, -93.7502, 180_000),
    Place("Worcester", "MA", 42.2626, -71.8023, 200_000),
    Place("Providence", "RI", 41.8240, -71.4128, 190_000),
    Place("Chattanooga", "TN", 35.0456, -85.3097, 180_000),
    Place("Fort Lauderdale", "FL", 26.1224, -80.1373, 180_000),
    Place("Tempe", "AZ", 33.4255, -111.9400, 190_000),
    Place("Garden Grove", "CA", 33.7739, -117.9414, 170_000),
    Place("Oceanside", "CA", 33.1959, -117.3795, 170_000),
    Place("Rancho Cucamonga", "CA", 34.1064, -117.5931, 180_000),
    Place("Santa Rosa", "CA", 38.4404, -122.7141, 180_000),
    Place("Vancouver", "WA", 45.6387, -122.6615, 190_000),
    Place("Sioux Falls", "SD", 43.5446, -96.7311, 200_000),
    Place("Peoria", "AZ", 33.5806, -112.2374, 190_000),
    Place("Ontario", "CA", 34.0633, -117.6509, 180_000),
    Place("Elk Grove", "CA", 38.4088, -121.3716, 180_000),
    Place("Salem", "OR", 44.9429, -123.0351, 180_000),
    Place("Pembroke Pines", "FL", 26.0078, -80.2962, 170_000),
    Place("Eugene", "OR", 44.0521, -123.0868, 180_000),
    Place("Cary", "NC", 35.7915, -78.7811, 180_000),
    Place("Apex", "NC", 35.7327, -78.8503, 70_000),
    Place("Chapel Hill", "NC", 35.9132, -79.0558, 60_000),
    Place("Asheville", "NC", 35.5951, -82.5515, 95_000),
    Place("Wilmington", "NC", 34.2257, -77.9447, 120_000),
    Place("Cary", "IL", 42.2119, -88.2384, 18_000),
    Place("Boulder", "CO", 40.0150, -105.2705, 110_000),
    Place("Ann Arbor", "MI", 42.2808, -83.7430, 120_000),
    Place("Iowa City", "IA", 41.6611, -91.5302, 75_000),
    Place("Berkeley", "CA", 37.8715, -122.2730, 120_000),
    Place("Cambridge", "MA", 42.3736, -71.1097, 120_000),
    Place("Provo", "UT", 40.2338, -111.6585, 120_000),
    Place("Fort Collins", "CO", 40.5853, -105.0844, 170_000),
    Place("Bellevue", "WA", 47.6101, -122.2015, 150_000),
    Place("Naperville", "IL", 41.7508, -88.1535, 150_000),
    Place("Pasadena", "CA", 34.1478, -118.1445, 140_000),
    Place("Sunnyvale", "CA", 37.3688, -122.0363, 150_000),
    Place("Alexandria", "VA", 38.8048, -77.0469, 160_000),
    Place("Clarksville", "TN", 36.5298, -87.3595, 170_000),
    Place("Killeen", "TX", 31.1171, -97.7278, 160_000),
    Place("College Station", "TX", 30.6280, -96.3344, 120_000),
    Place("Savannah", "GA", 32.0809, -81.0912, 150_000),
    Place("Charleston", "SC", 32.7765, -79.9311, 150_000),
    Place("Columbia", "SC", 34.0007, -81.0348, 140_000),
    Place("Greenville", "SC", 34.8526, -82.3940, 70_000),
    Place("Billings", "MT", 45.7833, -108.5007, 120_000),
    Place("Fargo", "ND", 46.8772, -96.7898, 130_000),
    Place("Cheyenne", "WY", 41.1400, -104.8202, 65_000),
    Place("Burlington", "VT", 44.4759, -73.2121, 45_000),
    Place("Portland", "ME", 43.6591, -70.2568, 70_000),
    Place("Manchester", "NH", 42.9956, -71.4548, 115_000),
    Place("Bridgeport", "CT", 41.1865, -73.1952, 150_000),
    Place("New Haven", "CT", 41.3083, -72.9279, 135_000),
)


def catalog_item_names() -> tuple[str, ...]:
    return tuple(row["name"] for row in CATALOG)


def catalog_loan_hours() -> dict[str, int]:
    """Item name -> default_loan_hours, from the real CATALOG in app/seed.py."""
    return {row["name"]: int(row["default_loan_hours"]) for row in CATALOG}


def inside_us(latitude: float, longitude: float) -> bool:
    return US_MIN_LAT <= latitude <= US_MAX_LAT and US_MIN_LNG <= longitude <= US_MAX_LNG


def parse_places_file(path: Path | str) -> list[Place]:
    """Read GeoNames cities15000.txt or a SimpleMaps-style US cities CSV."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Places file not found: {path}")
    text = path.read_text(encoding="utf-8", errors="replace")
    first = text.splitlines()[0] if text else ""
    if "\t" in first and first[:1].isdigit():
        return _parse_geonames(text)
    return _parse_simplemaps_csv(text)


def resolve_places(places_path: Path | str | None = None) -> list[Place]:
    """Prefer an on-disk places dump; otherwise use the nationwide bootstrap set."""
    if places_path is not None:
        return parse_places_file(places_path)
    for candidate in DEFAULT_PLACES_CANDIDATES:
        if candidate.is_file():
            return parse_places_file(candidate)
    return list(BOOTSTRAP_PLACES)


def generate_listings(
    places: list[Place],
    *,
    count: int = TARGET_COUNT,
    seed: int = SEED,
    items: tuple[str, ...] | None = None,
) -> list[dict]:
    """Population-weighted listings with a fixed seed for reproducibility.

    For the top ``min(CLUSTER_CITY_LIMIT, len(places))`` cities by population, a dense
    neighborhood cluster of ``CLUSTER_PER_CITY`` listings is embedded 0.1-3 miles from the
    city center first, so a default 2-mile radius search is never empty there. The rest of
    ``count`` is filled with population-weighted listings scattered a few hundred meters
    from a randomly chosen city center (never for real loans; ``is_sample`` is always true).
    """
    if not places:
        raise ValueError("Need at least one US place to generate sample listings.")
    usable = [place for place in places if place.population > 0 and inside_us(place.latitude, place.longitude)]
    if not usable:
        raise ValueError("No places with population inside the US bounds.")
    catalog = items or catalog_item_names()
    if not catalog:
        raise ValueError("Catalog is empty.")
    loan_hours = catalog_loan_hours()
    rng = random.Random(seed)
    # Stable order independent of input/file ordering so the same seed always clusters
    # the same cities in the same order.
    ranked = sorted(usable, key=lambda place: (-place.population, place.name, place.state))
    cluster_cities = ranked[: min(CLUSTER_CITY_LIMIT, len(ranked))]
    weights = [place.population for place in usable]
    rows: list[dict] = []

    def build_row(place: Place, lat: float, lng: float) -> dict:
        item = rng.choice(catalog)
        return {
            "id": f"{SAMPLE_ID_PREFIX}{len(rows):06d}",
            "latitude": round(lat, 6),
            "longitude": round(lng, 6),
            "city": place.name,
            "state": place.state,
            "item": item,
            "condition": rng.choice(CONDITIONS),
            "quantity": rng.randint(1, 5),
            "first_name": rng.choice(FIRST_NAMES),
            "last_initial": rng.choice(LAST_INITIALS),
            "max_loan_hours": int(loan_hours.get(item, DEFAULT_LOAN_HOURS)),
            "is_sample": True,
        }

    for place in cluster_cities:
        if len(rows) >= count:
            break
        for _ in range(CLUSTER_PER_CITY):
            if len(rows) >= count:
                break
            lat, lng = _offset_miles(place.latitude, place.longitude, rng, CLUSTER_MIN_MILES, CLUSTER_MAX_MILES)
            if not inside_us(lat, lng):
                lat, lng = place.latitude, place.longitude
            rows.append(build_row(place, lat, lng))

    while len(rows) < count:
        place = rng.choices(usable, weights=weights, k=1)[0]
        lat, lng = _offset_meters(place.latitude, place.longitude, rng)
        if not inside_us(lat, lng):
            lat, lng = place.latitude, place.longitude
        rows.append(build_row(place, lat, lng))

    return rows


def sample_listing_count(session: Session) -> int:
    return int(session.exec(select(func.count()).select_from(SampleListing)).one())


def ensure_sample_listings(session: Session, count: int = BOOTSTRAP_COUNT) -> int:
    """Seed or top up to ``count`` (default BOOTSTRAP_COUNT) at startup.

    If the table already has at least ``count`` rows (including a full TARGET_COUNT
    build), leave it alone. Never expands all the way to TARGET_COUNT here — that
    still belongs to ``scripts/build_sample_listings.py``.
    """
    existing = sample_listing_count(session)
    if existing >= count:
        return 0
    rows = generate_listings(resolve_places(), count=count, seed=SEED)
    return replace_sample_listings(session, rows)


def replace_sample_listings(session: Session, rows: list[dict]) -> int:
    """Drop previous sample rows and insert the generated set."""
    session.exec(delete(SampleListing))
    session.commit()
    batch: list[SampleListing] = []
    for raw in rows:
        batch.append(
            SampleListing(
                id=str(raw["id"]),
                latitude=float(raw["latitude"]),
                longitude=float(raw["longitude"]),
                city=str(raw.get("city") or ""),
                state=str(raw.get("state") or ""),
                item=str(raw["item"]),
                condition=str(raw.get("condition") or "Good"),
                quantity=max(1, int(raw.get("quantity") or 1)),
                first_name=str(raw.get("first_name") or ""),
                last_initial=str(raw.get("last_initial") or ""),
                max_loan_hours=max(1, int(raw.get("max_loan_hours") or DEFAULT_LOAN_HOURS)),
                is_sample=True,
            )
        )
        if len(batch) >= 1000:
            session.add_all(batch)
            session.commit()
            batch = []
    if batch:
        session.add_all(batch)
        session.commit()
    return len(rows)


EARTH_RADIUS_MILES = 3958.7613


def haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in miles between two WGS84 points."""
    rlat1, rlng1, rlat2, rlng2 = map(math.radians, (lat1, lng1, lat2, lng2))
    dlat = rlat2 - rlat1
    dlng = rlng2 - rlng1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(a)))


def bbox_for_radius(latitude: float, longitude: float, radius_miles: float) -> tuple[float, float, float, float]:
    """Axis-aligned envelope that contains the radius circle (prefilter for indexed lat/lng)."""
    radius = max(0.0, float(radius_miles))
    # ~69.17 miles per degree latitude
    dlat = radius / 69.17 if radius else 0.0
    cos_lat = math.cos(math.radians(latitude))
    dlng = radius / (69.17 * cos_lat) if abs(cos_lat) > 1e-6 and radius else 0.0
    return (
        longitude - dlng,
        latitude - dlat,
        longitude + dlng,
        latitude + dlat,
    )


def listings_in_bbox(
    session: Session,
    west: float,
    south: float,
    east: float,
    north: float,
    limit: int = 2000,
) -> list[dict]:
    limit = max(1, min(int(limit), 2000))
    if west > east:
        west, east = east, west
    if south > north:
        south, north = north, south
    statement = (
        select(SampleListing)
        .where(SampleListing.latitude >= south)
        .where(SampleListing.latitude <= north)
        .where(SampleListing.longitude >= west)
        .where(SampleListing.longitude <= east)
        .limit(limit)
    )
    return [_listing_out(row) for row in session.exec(statement).all()]


def listings_near(
    session: Session,
    latitude: float,
    longitude: float,
    radius_miles: float,
    limit: int = 2000,
) -> list[dict]:
    """BBox prefilter on indexed lat/lng, then exact haversine, nearest first."""
    limit = max(1, min(int(limit), 2000))
    radius = max(0.0, float(radius_miles))
    west, south, east, north = bbox_for_radius(latitude, longitude, radius)
    # Cap the prefilter so a dense 50 mi circle cannot load the whole table.
    prefilter_limit = max(limit * 4, 8000)
    statement = (
        select(SampleListing)
        .where(SampleListing.latitude >= south)
        .where(SampleListing.latitude <= north)
        .where(SampleListing.longitude >= west)
        .where(SampleListing.longitude <= east)
        .limit(prefilter_limit)
    )
    scored: list[tuple[float, dict]] = []
    for row in session.exec(statement).all():
        distance = haversine_miles(latitude, longitude, row.latitude, row.longitude)
        if distance <= radius + 1e-9:
            payload = _listing_out(row)
            payload["distance_miles"] = round(distance, 4)
            scored.append((distance, payload))
    scored.sort(key=lambda item: (item[0], item[1]["id"]))
    return [payload for _distance, payload in scored[:limit]]


def is_sample_id(inventory_id: str | None) -> bool:
    return bool(inventory_id) and str(inventory_id).startswith(SAMPLE_ID_PREFIX)


def _listing_out(row: SampleListing) -> dict:
    return {
        "id": row.id,
        "latitude": row.latitude,
        "longitude": row.longitude,
        "city": row.city,
        "state": row.state,
        "item": row.item,
        "condition": row.condition,
        "quantity": row.quantity,
        "first_name": row.first_name,
        "last_initial": row.last_initial,
        "max_loan_hours": row.max_loan_hours,
        "is_sample": True,
    }


def _offset_miles(
    latitude: float,
    longitude: float,
    rng: random.Random,
    min_miles: float,
    max_miles: float,
) -> tuple[float, float]:
    """Jitter a point a random distance (min_miles..max_miles) and bearing from center."""
    miles = rng.uniform(min_miles, max_miles)
    bearing = rng.uniform(0.0, 2.0 * math.pi)
    dlat = (miles / 69.17) * math.cos(bearing)
    cos_lat = math.cos(math.radians(latitude))
    dlng = (miles / (69.17 * cos_lat)) * math.sin(bearing) if abs(cos_lat) > 1e-6 else 0.0
    return latitude + dlat, longitude + dlng


def _offset_meters(latitude: float, longitude: float, rng: random.Random) -> tuple[float, float]:
    """Jitter a few hundred meters so pins do not stack on the city center."""
    meters = rng.uniform(80.0, 420.0)
    bearing = rng.uniform(0.0, 2.0 * math.pi)
    north = meters * math.cos(bearing)
    east = meters * math.sin(bearing)
    dlat = north / 111_320.0
    cos_lat = math.cos(math.radians(latitude))
    dlng = east / (111_320.0 * cos_lat) if abs(cos_lat) > 1e-6 else 0.0
    return latitude + dlat, longitude + dlng


def _parse_geonames(text: str) -> list[Place]:
    places: list[Place] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 15:
            continue
        country = parts[8].strip().upper()
        if country != "US":
            continue
        try:
            lat = float(parts[4])
            lng = float(parts[5])
            population = int(parts[14] or 0)
        except ValueError:
            continue
        if population <= 0 or not inside_us(lat, lng):
            continue
        name = parts[1].strip() or parts[2].strip()
        state = parts[10].strip()
        places.append(Place(name=name, state=state, latitude=lat, longitude=lng, population=population))
    return places


def _parse_simplemaps_csv(text: str) -> list[Place]:
    reader = csv.DictReader(text.splitlines())
    places: list[Place] = []
    for row in reader:
        keys = {key.lower(): key for key in row}
        name_key = keys.get("city") or keys.get("city_ascii") or keys.get("name")
        lat_key = keys.get("lat") or keys.get("latitude")
        lng_key = keys.get("lng") or keys.get("longitude") or keys.get("lon")
        pop_key = keys.get("population") or keys.get("pop")
        state_key = keys.get("state_id") or keys.get("state_name") or keys.get("state")
        if not (name_key and lat_key and lng_key and pop_key):
            continue
        try:
            lat = float(row[lat_key])
            lng = float(row[lng_key])
            population = int(float(row[pop_key] or 0))
        except ValueError:
            continue
        if population <= 0 or not inside_us(lat, lng):
            continue
        state = (row.get(state_key) or "").strip() if state_key else ""
        places.append(
            Place(
                name=str(row[name_key]).strip(),
                state=state,
                latitude=lat,
                longitude=lng,
                population=population,
            )
        )
    return places
