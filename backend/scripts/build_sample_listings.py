#!/usr/bin/env python3
"""Build ~100k sample listings from a real US places file (or bootstrap cities).

Download one of these into backend/data/ (do not commit the raw dump):
  - GeoNames cities15000.txt  (https://download.geonames.org/export/dump/)
  - SimpleMaps US Cities basic CSV

Examples:
  python scripts/build_sample_listings.py --places data/cities15000.txt
  python scripts/build_sample_listings.py --places data/uscities.csv --count 100000
  python scripts/build_sample_listings.py --bootstrap --count 100000

If the table already holds at least --count rows, the build is skipped (no
regeneration, no writes). Pass --force to rebuild anyway.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db import init_db, session_scope
from app.sample_listings import (
    BOOTSTRAP_PLACES,
    TARGET_COUNT,
    generate_listings,
    parse_places_file,
    replace_sample_listings,
    resolve_places,
    sample_listing_count,
)
from app import snowflake_store


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--places",
        type=Path,
        default=None,
        help="GeoNames cities15000.txt or SimpleMaps US cities CSV",
    )
    parser.add_argument(
        "--bootstrap",
        action="store_true",
        help="Use the built-in nationwide city list (no dump file required)",
    )
    parser.add_argument("--count", type=int, default=TARGET_COUNT)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--sqlite-only",
        action="store_true",
        help="Always write to local SQLite even when Snowflake env is configured",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Rebuild even if the table already holds --count rows or more",
    )
    args = parser.parse_args()

    use_snowflake = snowflake_store.configured() and not args.sqlite_only
    if not args.force:
        existing = _existing_sample_count(use_snowflake)
        if existing is not None and existing >= args.count:
            print(
                f"Already have {existing} sample rows (>= requested {args.count}); "
                "skipping build. Pass --force to rebuild anyway."
            )
            return 0

    if args.bootstrap:
        places = list(BOOTSTRAP_PLACES)
        source = "bootstrap"
    elif args.places is not None:
        places = parse_places_file(args.places)
        source = str(args.places)
    else:
        places = resolve_places()
        source = "auto"

    print(f"Loaded {len(places)} US places from {source}")
    rows = generate_listings(places, count=args.count, seed=args.seed)
    print(f"Generated {len(rows)} sample listings (seed={args.seed})")

    if use_snowflake:
        written = _write_snowflake(rows)
        print(f"Wrote {written} sample rows to Snowflake INVENTORY (is_sample=true)")
        return 0

    init_db()
    with session_scope() as session:
        written = replace_sample_listings(session, rows)
    print(f"Wrote {written} sample rows to SQLite SampleListing")
    return 0


def _existing_sample_count(use_snowflake: bool) -> int | None:
    """Rows already written, so a rerun can skip work instead of regenerating 100k rows."""
    if use_snowflake:
        try:
            return snowflake_store.count_sample_inventory()
        except snowflake_store.SnowflakeError:
            return None
    init_db()
    with session_scope() as session:
        return sample_listing_count(session)


def _write_snowflake(rows: list[dict]) -> int:
    snowflake_store.ensure_inventory_identity()
    snowflake_store.ensure_sample_column()
    snowflake_store.delete_sample_inventory()
    payload = []
    for row in rows:
        payload.append(
            {
                "inventory_id": row["id"],
                "resident_id": f"sample:{row['city']}:{row['state']}".lower().replace(" ", "-")[:80],
                "resident_name": f"{row.get('first_name', 'Sample')} {row.get('last_initial', '')}.".strip(),
                "x": row["longitude"],
                "y": row["latitude"],
                "catalog_item": row["item"],
                "quantity": row["quantity"],
                "willing_to_lend": True,
                "condition_note": f"Demo listing · {row['condition']} · max {row.get('max_loan_hours', 4)}h",
                "available_windows": [],
                "category": "",
                "condition": row["condition"],
                "is_sample": True,
            }
        )
    snowflake_store.insert_inventory_many(payload)
    return len(payload)


if __name__ == "__main__":
    raise SystemExit(main())
