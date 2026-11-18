from contextlib import asynccontextmanager
from datetime import datetime
import hashlib
import json

from fastapi import Depends, FastAPI, HTTPException, Request, Response

from app.address import apply_verification, clear_verification, is_address_verified
from app.admin import router as admin_router
from app.auth import current_actor, same_resident
from app.geocode_service import geocode_center, geocode_suggest
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.db import get_session, init_db, session_scope
from app.logic import (
    activity,
    add_tool,
    confirm_handoff,
    confirm_request,
    create_loan,
    decline_handoff,
    garden_count,
    join_group_buy,
    leave_group_buy,
    handle_chat,
    create_shelf_item,
    delete_shelf_item,
    inventory_view,
    my_stuff,
    neighborhood,
    normalize_profile_city,
    normalize_profile_street,
    pickup_loan,
    profile_onboarded,
    projects_for,
    receive_handoff,
    remove_tool,
    respond_loan,
    return_loan,
    shared_demand,
    start_group_buy,
    update_shelf_item,
    update_tool,
)
from app.models import CatalogItem, Resident
from app.sample_listings import listings_in_bbox, listings_near
from app.seed import ensure_extra_inventory, initials_for, seed
from app.snowflake_store import SnowflakeError, configured as snowflake_configured, status as snowflake_status, upsert_profile


class ProfileIn(BaseModel):
    clerk_user_id: str
    name: str
    email: str = ""
    initials: str
    street: str = ""
    city: str = ""
    about: str = ""
    latitude: float | None = None
    longitude: float | None = None
    formatted_address: str | None = None
    state: str | None = None


class ProfilePatch(BaseModel):
    clerk_user_id: str
    street: str | None = None
    city: str | None = None
    about: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    formatted_address: str | None = None
    state: str | None = None


class ResidentIn(BaseModel):
    id: str
    name: str
    street: str
    short_name: str | None = None
    x: float = 0
    y: float = 0


class GroupBuyIn(BaseModel):
    resident_id: str | None = None


def _member(actor: str | None, body: GroupBuyIn) -> str:
    resident = same_resident(actor, body.resident_id) if body.resident_id else actor
    if resident is None:
        raise HTTPException(status_code=422, detail="resident_id is required")
    return resident


class ChatIn(BaseModel):
    resident_id: str
    message: str
    include_demo_listings: bool = False
    radius_miles: float = 2.0


class ToolPatch(BaseModel):
    optional: bool | None = None
    have_already: bool | None = None


class ToolIn(BaseModel):
    catalog_item_id: str
    optional: bool = False


class LoanIn(BaseModel):
    borrower_id: str
    lender_id: str
    catalog_item_id: str
    window_start: datetime
    window_end: datetime
    quantity: int = Field(default=1, ge=1)
    inventory_id: str | None = None


class LoanRespond(BaseModel):
    action: str
    window_start: datetime | None = None
    window_end: datetime | None = None


class ResidentAction(BaseModel):
    resident_id: str


class ShelfIn(BaseModel):
    resident_id: str
    name: str
    category: str = "Household"
    quantity: int = Field(default=1, ge=0, le=99)
    condition: str = ""
    notes: str = ""
    available_to_lend: bool = True


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    try:
        from app.snowflake_store import SnowflakeError, ensure_inventory_identity

        ensure_inventory_identity()
    except SnowflakeError:
        pass
    with session_scope() as session:
        seed(session)
        from app.logic import retry_reconciliations
        from app.sample_listings import ensure_sample_listings

        retry_reconciliations(session)
        ensure_sample_listings(session)
    ensure_extra_inventory()
    yield


def _profile_out(resident: Resident) -> dict:
    verified = is_address_verified(resident)
    return {
        "id": resident.id,
        "name": resident.name,
        "resident_id": resident.id,
        "street": resident.street,
        "city": resident.city,
        "about": resident.about,
        "onboarded": profile_onboarded(resident.street, resident.city),
        "state": resident.state or "",
        "formatted_address": resident.formatted_address or "",
        "latitude": resident.latitude,
        "longitude": resident.longitude,
        "verified_at": resident.verified_at.isoformat() if resident.verified_at else None,
        "address_verified": verified,
    }


def _payload_etag(payload: object) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f'"{digest}"'


def _etag_response(request: Request, response: Response, payload: list | dict):
    etag = _payload_etag(payload)
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "max-age=60, must-revalidate"
    if request.headers.get("if-none-match") == etag:
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": "max-age=60, must-revalidate"},
        )
    return payload


def create_app() -> FastAPI:
    app = FastAPI(title="Relay", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
            "capacitor://localhost",
            "http://localhost",
        ],
        allow_origin_regex=r"https?://(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["ETag", "Cache-Control"],
    )

    @app.get("/")
    def root():
        return {"name": "Relay", "docs": "/docs", "health": "/health"}

    @app.get("/health")
    def health():
        body = {"status": "ok"}
        body.update(snowflake_status())
        return body

    @app.get("/api/residents")
    def list_residents(
        request: Request,
        response: Response,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        rows = session.exec(select(Resident)).all()
        payload = []
        for row in rows:
            # Unverified profiles stay off other people's maps (self is always included).
            if actor is not None and row.id != actor and not is_address_verified(row):
                continue
            payload.append(
                {
                    "id": row.id,
                    "name": row.name,
                    "short_name": row.short_name,
                    "street": row.street,
                    "initials": row.initials,
                    "x": row.x,
                    "y": row.y,
                    "city": row.city,
                    "latitude": row.latitude,
                    "longitude": row.longitude,
                    "address_verified": is_address_verified(row),
                }
            )
        return _etag_response(request, response, payload)

    @app.get("/api/me")
    def get_me(
        clerk_user_id: str,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        clerk_user_id = same_resident(actor, clerk_user_id)
        resident = session.get(Resident, clerk_user_id)
        if resident is None:
            return {
                "resident_id": None,
                "street": "",
                "city": "",
                "about": "",
                "onboarded": False,
                "state": "",
                "formatted_address": "",
                "latitude": None,
                "longitude": None,
                "verified_at": None,
                "address_verified": False,
            }
        return _profile_out(resident)

    @app.post("/api/me")
    def save_me(
        body: ProfileIn,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        body.clerk_user_id = same_resident(actor, body.clerk_user_id)
        street = normalize_profile_street(body.street)
        city = normalize_profile_city(body.city)
        about = body.about.strip()
        if snowflake_configured():
            try:
                upsert_profile(
                    body.clerk_user_id,
                    body.name,
                    body.email,
                    body.initials,
                    street,
                    city,
                    about,
                )
            except SnowflakeError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
        short_name = body.name.split()[0] if body.name.split() else body.initials
        resident = session.get(Resident, body.clerk_user_id)
        if resident is None:
            resident = Resident(
                id=body.clerk_user_id,
                name=body.name,
                short_name=short_name,
                street=street,
                initials=body.initials,
                x=0,
                y=0,
            )
        else:
            resident.name = body.name
            resident.short_name = short_name
            resident.street = street
            resident.initials = body.initials
        resident.city = city
        resident.about = about
        apply_verification(
            resident,
            street=street,
            city=city,
            latitude=body.latitude,
            longitude=body.longitude,
            formatted_address=body.formatted_address,
            state=body.state,
        )
        session.add(resident)
        session.commit()
        return _profile_out(resident)

    @app.patch("/api/me")
    def patch_me(
        body: ProfilePatch,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        clerk_user_id = same_resident(actor, body.clerk_user_id)
        resident = session.get(Resident, clerk_user_id)
        if resident is None:
            raise HTTPException(status_code=404, detail="Profile not found.")
        street_changed = body.street is not None
        city_changed = body.city is not None
        if street_changed:
            resident.street = normalize_profile_street(body.street)
        if city_changed:
            resident.city = normalize_profile_city(body.city)
        if body.about is not None:
            resident.about = body.about.strip()
        verifying = any(
            value is not None
            for value in (body.latitude, body.longitude, body.formatted_address, body.state)
        )
        if verifying:
            apply_verification(
                resident,
                street=resident.street,
                city=resident.city,
                latitude=body.latitude,
                longitude=body.longitude,
                formatted_address=body.formatted_address,
                state=body.state,
            )
        elif street_changed or city_changed:
            # Address text changed without a new Mapbox pick — drop the old pin.
            clear_verification(resident)
        if snowflake_configured():
            try:
                upsert_profile(
                    resident.id,
                    resident.name,
                    "",
                    resident.initials,
                    resident.street,
                    resident.city,
                    resident.about,
                )
            except SnowflakeError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
        session.add(resident)
        session.commit()
        return _profile_out(resident)

    @app.post("/api/residents", status_code=201)
    def create_resident(
        body: ResidentIn,
        session: Session = Depends(get_session),
        _actor: str | None = Depends(current_actor),
    ):
        if session.get(Resident, body.id) is not None:
            raise HTTPException(status_code=409, detail="Resident already exists")
        resident = Resident(
            id=body.id,
            name=body.name,
            short_name=body.short_name or body.name.split()[0],
            street=body.street,
            initials=initials_for(body.name),
            x=body.x,
            y=body.y,
        )
        session.add(resident)
        session.commit()
        return {"id": resident.id, "name": resident.name, "initials": resident.initials}

    @app.get("/api/catalog")
    def list_catalog(
        request: Request,
        response: Response,
        session: Session = Depends(get_session),
        _actor: str | None = Depends(current_actor),
    ):
        rows = session.exec(select(CatalogItem)).all()
        payload = [
            {
                "id": row.id,
                "name": row.name,
                "category": row.category,
                "demo_price_cents": row.demo_price_cents,
                "default_loan_hours": row.default_loan_hours,
            }
            for row in rows
        ]
        return _etag_response(request, response, payload)

    @app.post("/api/chat")
    def chat(
        body: ChatIn,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return handle_chat(
            session,
            same_resident(actor, body.resident_id),
            body.message,
            body.include_demo_listings,
            body.radius_miles,
        )

    @app.post("/api/requests/{request_id}/confirm")
    def post_confirm_request(
        request_id: str,
        body: ResidentAction,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return confirm_request(session, request_id, same_resident(actor, body.resident_id))

    @app.get("/api/projects")
    def list_projects(
        resident_id: str = "avery",
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return projects_for(session, same_resident(actor, resident_id))

    @app.patch("/api/projects/{project_id}/tools/{tool_id}")
    def patch_tool(
        project_id: str,
        tool_id: str,
        body: ToolPatch,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return update_tool(session, project_id, tool_id, body.optional, body.have_already, actor)

    @app.post("/api/projects/{project_id}/tools", status_code=201)
    def post_tool(
        project_id: str,
        body: ToolIn,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return add_tool(session, project_id, body.catalog_item_id, body.optional, actor)

    @app.delete("/api/projects/{project_id}/tools/{tool_id}")
    def delete_tool(
        project_id: str,
        tool_id: str,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return remove_tool(session, project_id, tool_id, actor)

    @app.get("/api/inventory")
    def list_inventory(
        resident_id: str | None = None,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        if actor is not None:
            resident_id = same_resident(actor, resident_id or actor)
        return inventory_view(session, resident_id)

    @app.post("/api/inventory", status_code=201)
    def post_inventory(
        body: ShelfIn,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return create_shelf_item(
            session,
            same_resident(actor, body.resident_id),
            body.name,
            body.category,
            body.quantity,
            body.condition,
            body.notes,
            body.available_to_lend,
        )

    @app.patch("/api/inventory/{item_id}")
    def patch_inventory(
        item_id: str,
        body: ShelfIn,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return update_shelf_item(
            session,
            same_resident(actor, body.resident_id),
            item_id,
            body.name,
            body.category,
            body.quantity,
            body.condition,
            body.notes,
            body.available_to_lend,
        )

    @app.delete("/api/inventory/{item_id}")
    def remove_inventory(
        item_id: str,
        resident_id: str,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return delete_shelf_item(session, same_resident(actor, resident_id), item_id)

    @app.get("/api/my-stuff")
    def get_my_stuff(
        resident_id: str = "avery",
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return my_stuff(session, same_resident(actor, resident_id))

    @app.get("/api/neighborhood")
    def get_neighborhood(
        resident_id: str = "avery",
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return neighborhood(session, same_resident(actor, resident_id))

    @app.get("/api/listings")
    def get_listings(
        bbox: str | None = None,
        radius_miles: float | None = None,
        lat: float | None = None,
        lng: float | None = None,
        limit: int = 2000,
        session: Session = Depends(get_session),
        _actor: str | None = Depends(current_actor),
    ):
        """Sample map pins near a point (preferred) or inside a view bbox. Cap 2000."""
        if radius_miles is not None:
            if lat is None or lng is None:
                raise HTTPException(
                    status_code=400,
                    detail="lat and lng are required when radius_miles is set.",
                )
            if not (1 <= float(radius_miles) <= 50):
                raise HTTPException(status_code=400, detail="radius_miles must be between 1 and 50.")
            rows = listings_near(session, float(lat), float(lng), float(radius_miles), limit=limit)
            return {
                "items": rows,
                "count": len(rows),
                "is_sample": True,
                "radius_miles": float(radius_miles),
            }
        if not bbox:
            raise HTTPException(
                status_code=400,
                detail="Provide radius_miles with lat/lng, or bbox=west,south,east,north.",
            )
        try:
            west, south, east, north = (float(part.strip()) for part in bbox.split(","))
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail="bbox must be west,south,east,north as four numbers.",
            ) from exc
        rows = listings_in_bbox(session, west, south, east, north, limit=limit)
        return {"items": rows, "count": len(rows), "is_sample": True}

    @app.get("/api/activity")
    def get_activity(
        resident_id: str | None = None,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        if actor is not None and resident_id is not None:
            resident_id = same_resident(actor, resident_id)
        elif actor is not None:
            resident_id = actor
        return activity(session, resident_id)

    @app.post("/api/loans", status_code=201)
    def post_loan(
        body: LoanIn,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return create_loan(
            session,
            same_resident(actor, body.borrower_id),
            body.lender_id,
            body.catalog_item_id,
            body.window_start,
            body.window_end,
            body.quantity,
            body.inventory_id,
        )

    @app.post("/api/loans/{loan_id}/respond")
    def post_respond(
        loan_id: str,
        body: LoanRespond,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return respond_loan(session, loan_id, body.action, body.window_start, body.window_end, actor)

    @app.post("/api/loans/{loan_id}/pickup")
    def post_pickup(
        loan_id: str,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return pickup_loan(session, loan_id, actor)

    @app.post("/api/loans/{loan_id}/return")
    def post_return(
        loan_id: str,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return return_loan(session, loan_id, actor)

    @app.post("/api/handoffs/{handoff_id}/confirm")
    def post_confirm(
        handoff_id: str,
        body: ResidentAction,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return confirm_handoff(session, handoff_id, same_resident(actor, body.resident_id))

    @app.post("/api/handoffs/{handoff_id}/decline")
    def post_decline(
        handoff_id: str,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return decline_handoff(session, handoff_id, actor)

    @app.post("/api/handoffs/{handoff_id}/received")
    def post_received(
        handoff_id: str,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return receive_handoff(session, handoff_id, actor)

    @app.get("/api/shared-demand")
    def get_shared_demand(
        session: Session = Depends(get_session),
        _actor: str | None = Depends(current_actor),
    ):
        return shared_demand(session)

    @app.post("/api/shared-demand/{catalog_item_id}/group-buy")
    def post_group_buy(
        catalog_item_id: str,
        body: GroupBuyIn | None = None,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        resident = same_resident(actor, body.resident_id) if body and body.resident_id else actor
        return start_group_buy(session, catalog_item_id, resident)

    @app.post("/api/shared-demand/{catalog_item_id}/group-buy/join")
    def post_join_group_buy(
        catalog_item_id: str,
        body: GroupBuyIn,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return join_group_buy(session, catalog_item_id, _member(actor, body))

    @app.delete("/api/shared-demand/{catalog_item_id}/group-buy/join")
    def delete_join_group_buy(
        catalog_item_id: str,
        resident_id: str | None = None,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
    ):
        return leave_group_buy(session, catalog_item_id, _member(actor, GroupBuyIn(resident_id=resident_id)))

    @app.get("/api/garden")
    def get_garden(
        session: Session = Depends(get_session),
        _actor: str | None = Depends(current_actor),
    ):
        return garden_count(session)

    @app.get("/api/geocode")
    def get_geocode(
        q: str,
        session: Session = Depends(get_session),
        actor: str | None = Depends(current_actor),
        city: str = "",
        autocomplete: bool = False,
        limit: int = 5,
    ):
        """Shared Mapbox geocode proxy with 30-day SQLite cache and per-user rate limit."""
        actor_id = actor or "open"
        if autocomplete:
            return geocode_suggest(
                session,
                query=q,
                city=city,
                actor_id=actor_id,
                limit=max(1, min(limit, 5)),
            )
        return geocode_center(session, query=q, city=city, actor_id=actor_id)

    app.include_router(admin_router)
    return app


app = create_app()
