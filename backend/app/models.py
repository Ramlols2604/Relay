from datetime import datetime

from sqlalchemy import Index
from sqlmodel import Field, SQLModel


class Resident(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    short_name: str
    street: str
    initials: str
    x: float = 0
    y: float = 0
    city: str = ""
    about: str = ""
    latitude: float | None = None
    longitude: float | None = None
    formatted_address: str = ""
    state: str = ""
    verified_at: datetime | None = None


class CatalogItem(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    aliases: str
    category: str
    demo_price_cents: int
    default_loan_hours: int


class Project(SQLModel, table=True):
    id: str = Field(primary_key=True)
    resident_id: str
    raw_text: str
    window_start: datetime | None = None
    window_end: datetime | None = None
    created_at: datetime


class ProjectTool(SQLModel, table=True):
    id: str = Field(primary_key=True)
    project_id: str
    catalog_item_id: str
    name: str | None = None
    position: int = 0
    optional: bool = False
    have_already: bool = False


class Request(SQLModel, table=True):
    id: str = Field(primary_key=True)
    resident_id: str
    kind: str
    raw_text: str
    catalog_item_id: str
    quantity: int
    area: str | None = None
    window_start: datetime | None = None
    window_end: datetime | None = None
    status: str
    created_at: datetime


class Loan(SQLModel, table=True):
    id: str = Field(primary_key=True)
    lender_id: str
    borrower_id: str
    inventory_id: str | None = None
    catalog_item_id: str
    request_id: str | None = None
    window_start: datetime
    window_end: datetime
    status: str
    quantity: int = 1
    created_at: datetime


class Handoff(SQLModel, table=True):
    id: str = Field(primary_key=True)
    need_request_id: str
    recipient_id: str
    status: str
    recipient_confirmed: bool = False
    created_at: datetime


class HandoffAllocation(SQLModel, table=True):
    id: str = Field(primary_key=True)
    handoff_id: str
    offer_request_id: str
    resident_id: str
    quantity: int
    donor_confirmed: bool = False


class GardenEvent(SQLModel, table=True):
    id: str = Field(primary_key=True)
    kind: str
    loan_id: str | None = None
    handoff_id: str | None = None
    created_at: datetime


class GroupBuy(SQLModel, table=True):
    id: str = Field(primary_key=True)
    catalog_item_id: str
    created_at: datetime


class GroupBuyMember(SQLModel, table=True):
    id: str = Field(primary_key=True)
    catalog_item_id: str
    resident_id: str
    created_at: datetime


class ShelfItem(SQLModel, table=True):
    id: str = Field(primary_key=True)
    resident_id: str
    name: str
    category: str = "Household"
    quantity: int = 1
    condition: str = ""
    notes: str = ""
    available_to_lend: bool = True
    catalog_item_id: str | None = None


class StockRow(SQLModel, table=True):
    """Generated inventory used when Snowflake is not the source of truth."""

    id: str = Field(primary_key=True)
    resident_id: str
    resident_name: str
    x: float = 0
    y: float = 0
    catalog_item: str
    quantity: int = 1
    willing_to_lend: bool = True
    condition_note: str = ""


class Reconciliation(SQLModel, table=True):
    """A Snowflake restore or delete that still needs to be retried."""

    id: str = Field(primary_key=True)
    action: str
    inventory_id: str
    payload: str = ""
    attempts: int = 0
    last_error: str = ""
    created_at: datetime


class AuditLog(SQLModel, table=True):
    id: str = Field(primary_key=True)
    at: datetime
    actor: str
    action: str
    target_type: str
    target_id: str
    detail: str = ""


class SampleListing(SQLModel, table=True):
    """Generated lendable items on real US cities. Never matched into real loans."""

    __tablename__ = "samplelisting"
    __table_args__ = (Index("ix_samplelisting_lat_lng", "latitude", "longitude"),)

    id: str = Field(primary_key=True)
    latitude: float = Field(index=True)
    longitude: float = Field(index=True)
    city: str = ""
    state: str = ""
    item: str
    condition: str = "Good"
    quantity: int = 1
    first_name: str = ""
    last_initial: str = ""
    max_loan_hours: int = 4
    is_sample: bool = True


class GeocodeCache(SQLModel, table=True):
    """Normalized Mapbox query → JSON body. Shared across all users (30-day TTL)."""

    __tablename__ = "geocodecache"

    query_key: str = Field(primary_key=True)
    result_json: str
    created_at: datetime


class GeocodeRateWindow(SQLModel, table=True):
    """Per-user Mapbox call budget for the current hour."""

    __tablename__ = "geocoderatewindow"

    actor_id: str = Field(primary_key=True)
    window_start: datetime
    count: int = 0


class UsageCounter(SQLModel, table=True):
    """Simple named counters (geocode Mapbox calls, cache hits, …)."""

    __tablename__ = "usagecounter"

    name: str = Field(primary_key=True)
    value: int = 0
