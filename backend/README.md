# Relay backend

FastAPI service for the Relay hackathon app. The Vite UI stays at the repo root. This API does not change those pages.

Snowflake credentials stay empty until the warehouse is set up and the inventory dataset is uploaded. The API boots without them. Inventory and neighborhood reads return `snowflake: "not_configured"` and an empty list. Confirmed needs, offers, and borrow asks are stored in SQLite until those env vars are filled, then the same routes write and read Snowflake.

Loans, handoffs, projects, and the garden counter stay in SQLite (`backend/relay.db`).

## Run

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Docs: http://127.0.0.1:8000/docs

The UI dev server is http://127.0.0.1:5173. CORS allows that origin.

```bash
npm install
npm run dev
```

## Snowflake

Copy nothing into git. Put credentials only in `backend/.env` (gitignored):

- `SNOWFLAKE_ACCOUNT`
- `SNOWFLAKE_USER`
- `SNOWFLAKE_PASSWORD`
- `SNOWFLAKE_WAREHOUSE`
- `SNOWFLAKE_DATABASE`
- `SNOWFLAKE_SCHEMA`
- `SNOWFLAKE_ROLE`

`GET /health` reports `not_configured`, `ok`, or `error`.

Inventory SQL lives in `app/snowflake_store.py`. Until the upload is visible it expects `INVENTORY` columns: `RESIDENT_ID`, `RESIDENT_NAME`, `X`, `Y`, `CATALOG_ITEM`, `QUANTITY`, `WILLING_TO_LEND`, `CONDITION_NOTE`, `AVAILABLE_WINDOWS`.

Confirmed requests expect a `REQUESTS` table: `ID`, `RESIDENT_ID`, `KIND` (`need`, `offer`, or `borrow`), `RAW_TEXT`, `CATALOG_ITEM`, `QUANTITY`, `AREA`, `WINDOW_START`, `WINDOW_END`, `STATUS`, `CREATED_AT`.

Catalog names the matcher knows: Drill, Saw, Level, Sander, Clamps, Tape measure, Notebooks, Ladder. Aliases such as "cordless drill" map to Drill. A drill's demo price is 6000 cents ($60).

Chat extraction tries providers in `RELAY_LLM_ORDER` (default `gemini,ollama,backboard`), skipping any that are not configured, then the built-in parser — all inside the same time limit. Set `GEMINI_API_KEY` for Gemini-first. `OLLAMA_HOST` (for example `http://127.0.0.1:11434`) and `OLLAMA_MODEL` (default `llama3.2`) enable a local Ollama model when it appears in the order.

Mapbox: put a **public, URL-restricted** token in the repo-root `.env.local` as `VITE_MAPBOX_ACCESS_TOKEN` (Map GL only). Put a **separate secret** token in `backend/.env` as `MAPBOX_ACCESS_TOKEN` (or `MAPBOX_TOKEN`) for `/api/geocode`. The API will not fall back to the Vite public token.

`RELAY_ADMIN_USER_IDS` is a comma-separated list of Clerk user ids allowed to use `/api/admin` and the Admin page. Empty means nobody.

## Demo listings (map pins)

Server startup seeds a small, fast bootstrap set of `BOOTSTRAP_COUNT = 5,000` demo listings (`app/sample_listings.py`, `ensure_sample_listings`) only when the `samplelisting` table is empty — it never regenerates or tops up to the full nationwide set, so boot stays quick. All rows have `is_sample=true`, never match into real loans, and are hidden from the admin people list. The map and API label them "Demo listing" and never offer a way to contact the generated person. The UI turns demo pins **on automatically only when the signed-in account has no real neighbors** in the current city view; otherwise they stay off unless the user toggles them. Chat nearby-lender cards mark demos and disable "Request to borrow"; the API rejects borrow asks against sample ids.

To build the full `TARGET_COUNT = 100,000` population-weighted nationwide dataset (reproducible with `seed=42`), run `backend/scripts/build_sample_listings.py` offline. It is safe to rerun: if the table already holds at least `--count` rows it prints a message and skips all work (pass `--force` to rebuild anyway).

Quickest option — no download required, uses the built-in nationwide city list:

```bash
cd backend
.venv/bin/python scripts/build_sample_listings.py --bootstrap --sqlite-only
```

For a more complete set of US places, download one of these into `backend/data/` first (gitignored — do not commit the raw dump):

- GeoNames `cities15000.txt`: https://download.geonames.org/export/dump/cities15000.zip (unzip into `backend/data/cities15000.txt`)
- SimpleMaps US Cities (basic, free): https://simplemaps.com/data/us-cities (save the CSV as `backend/data/uscities.csv`)

```bash
cd backend
curl -L -o data/cities15000.zip https://download.geonames.org/export/dump/cities15000.zip
unzip -o data/cities15000.zip cities15000.txt -d data/
.venv/bin/python scripts/build_sample_listings.py --places data/cities15000.txt --sqlite-only
```

Each generated row gets a random first name + last initial (from a ~40-name pool and A-Z), an item drawn from `CATALOG`, quantity 1-5, a condition, and `max_loan_hours` copied from that item's `default_loan_hours` in `app/seed.py`. The top 200 cities by population each get a dense cluster of listings jittered 0.1-3 miles from the city center, so the default 2-mile radius search is never empty there (e.g. Cary NC, Raleigh NC, Chicago IL).

Other flags: `--count` (default `TARGET_COUNT`), `--seed` (default `42`), `--sqlite-only` (always write local SQLite even if Snowflake env vars are set), `--force` (rebuild even if the table already has enough rows).

`GEMINI_API_KEY` is optional. With no key, chat uses the catalog and a bookshelf tool list.

## Chat cards

`POST /api/chat` with `{ "resident_id": "avery", "message": "..." }`.

- `tool_list` for a project such as "I'm building a bookshelf this weekend."
- `confirmation` for a need or offer. A later message of `yes` or `no` publishes or drops it.
- `match` when an open need lines up with offers. Partial fills are included.
- `loan_status` when a loan or handoff changes.
- `no_match` when a request stays open or the message is unclear.
- `yes` / `no` also accepts or declines the latest loan request for a lender, or confirms a handoff.

Default resident is Avery Moss, id `avery`, 14 Willow Court.

## Other routes

- `GET /api/my-stuff?resident_id=avery`
- `GET /api/neighborhood?resident_id=avery`
- `GET /api/activity?resident_id=avery`
- `POST /api/loans` then `.../respond`, `.../pickup`, `.../return`
- `POST /api/handoffs/{id}/confirm`, `.../decline`, `.../received`
- `GET /api/shared-demand` and `POST /api/shared-demand/{catalog_item_id}/group-buy`
- `GET /api/garden` returns `{ "count" }` of completed loans and handoffs

A taken loan window returns 409 and `next_free_slot`. Shared demand does not claim that nobody owns an item while inventory is unavailable.

## Tests

```bash
cd backend
python -m pytest
```

Matcher and scheduler tests do not need Snowflake. After the inventory upload, fill in `.env` and hit My Stuff, Neighborhood, and the notebook and drill flows again.
