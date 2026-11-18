"""Admin API. Every route needs an admin and every change is written to the audit log."""

import json
import os
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app import snowflake_store
from app.auth import auth_disabled, current_actor
from app.config import admin_user_ids, clerk_issuer, clerk_secret_key, ollama_host, ollama_model
from app.db import get_session
from app.extract import active_llm_order, provider_stats
from app.logic import (
    _loan_dict,
    _requests_for_activity,
    _set_request_status,
    return_loan,
    shared_demand,
)
from app.models import (
    AuditLog,
    CatalogItem,
    GardenEvent,
    GroupBuy,
    GroupBuyMember,
    Handoff,
    Loan,
    Request,
    Resident,
    ShelfItem,
)

LOAN_STATUSES = {"requested", "confirmed", "picked_up", "returned", "declined"}
OPEN_LOAN_STATUSES = {"requested", "confirmed", "picked_up"}


def require_admin(actor: str | None = Depends(current_actor)) -> str:
    """Admins are the Clerk user ids in RELAY_ADMIN_USER_IDS. Open mode (tests only) lets everyone in."""
    if auth_disabled():
        return "open-mode"
    if actor is None or actor not in admin_user_ids():
        raise HTTPException(status_code=403, detail="This account is not an admin.")
    return actor


router = APIRouter(prefix="/api/admin", tags=["admin"])


def _audit(session: Session, actor: str, action: str, target_type: str, target_id: str, detail: dict | None = None):
    session.add(
        AuditLog(
            id=uuid4().hex,
            # Full precision, unlike clock.now(), so entries made in the same second keep their order.
            at=datetime.now(timezone.utc),
            actor=actor,
            action=action,
            target_type=target_type,
            target_id=target_id,
            detail=json.dumps(detail or {}, sort_keys=True, default=str),
        )
    )


def _count(session: Session, model, *where) -> int:
    return len(session.exec(select(model).where(*where)).all())


class ResidentPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    street: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=80)
    about: str | None = Field(default=None, max_length=500)


class CatalogPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    demo_price_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    default_loan_hours: int | None = Field(default=None, ge=1, le=24 * 30)


class LoanStatusIn(BaseModel):
    status: str


@router.get("/me")
def admin_me(actor: str = Depends(require_admin)):
    return {"admin": True, "actor": actor}


@router.get("/overview")
def overview(session: Session = Depends(get_session), _admin: str = Depends(require_admin)):
    loans = session.exec(select(Loan)).all()
    by_status: dict[str, int] = {}
    for loan in loans:
        by_status[loan.status] = by_status.get(loan.status, 0) + 1
    overdue = sum(1 for loan in loans if _loan_dict(loan)["overdue"])
    requests = _requests_for_activity(session)
    req_status: dict[str, int] = {}
    for row in requests:
        req_status[row["status"]] = req_status.get(row["status"], 0) + 1
    handoff_status: dict[str, int] = {}
    for row in session.exec(select(Handoff)).all():
        handoff_status[row.status] = handoff_status.get(row.status, 0) + 1
    from app.geocode_service import mapbox_access_token, usage_counts

    geocode_usage = usage_counts(session)
    return {
        "counts": {
            "residents": _count(session, Resident),
            "shelf_items": _count(session, ShelfItem),
            "catalog_items": _count(session, CatalogItem),
            "loans": len(loans),
            "overdue_loans": overdue,
            "requests": len(requests),
            "handoffs": sum(handoff_status.values()),
            "group_buys": _count(session, GroupBuy),
            "exchanges_finished": _count(session, GardenEvent),
            "geocode_calls": geocode_usage["geocode_calls"],
            "geocode_cache_hits": geocode_usage["geocode_cache_hits"],
        },
        "loans_by_status": by_status,
        "requests_by_status": req_status,
        "handoffs_by_status": handoff_status,
        "integrations": {**integrations(), "mapbox": bool(mapbox_access_token())},
    }


def integrations() -> dict:
    """Which services are configured. Reports yes or no, never the values."""
    return {
        "snowflake": snowflake_store.status(),
        "ollama": {"configured": bool(ollama_host()), "model": ollama_model() if ollama_host() else None},
        "gemini": bool(os.environ.get("GEMINI_API_KEY", "").strip()),
        "backboard": bool(os.environ.get("BACKBOARD_API_KEY", "").strip()),
        "clerk": bool(clerk_secret_key() and clerk_issuer()),
        "admins_configured": len(admin_user_ids()),
        "auth_enforced": not auth_disabled(),
        # Extraction provider order actually in use (RELAY_LLM_ORDER, minus unknown or
        # unconfigured names) and how often each provider has answered or failed since
        # this process started.
        "llm_order": active_llm_order(),
        "llm_provider_stats": provider_stats(),
    }


@router.get("/residents")
def list_residents(
    q: str = "",
    session: Session = Depends(get_session),
    _admin: str = Depends(require_admin),
):
    needle = q.strip().lower()
    rows = session.exec(select(Resident).order_by(Resident.name)).all()
    return [
        {
            "id": row.id,
            "name": row.name,
            "street": row.street,
            "city": row.city,
            "about": row.about,
            "loans": _count(session, Loan, (Loan.lender_id == row.id) | (Loan.borrower_id == row.id)),
        }
        for row in rows
        if not str(row.id).startswith("sample:")
        and (not needle or needle in f"{row.id} {row.name} {row.street} {row.city}".lower())
    ]


@router.patch("/residents/{resident_id}")
def patch_resident(
    resident_id: str,
    body: ResidentPatch,
    session: Session = Depends(get_session),
    admin: str = Depends(require_admin),
):
    resident = session.get(Resident, resident_id)
    if resident is None:
        raise HTTPException(status_code=404, detail="Unknown resident")
    changes = body.model_dump(exclude_none=True)
    if "name" in changes:
        changes["name"] = " ".join(changes["name"].split())
        if not changes["name"]:
            raise HTTPException(status_code=422, detail="Name cannot be blank")
    for key, value in changes.items():
        setattr(resident, key, value)
    session.add(resident)
    _audit(session, admin, "resident.update", "resident", resident_id, changes)
    session.commit()
    return {"id": resident.id, "name": resident.name, "street": resident.street, "city": resident.city, "about": resident.about}


@router.delete("/residents/{resident_id}")
def delete_resident(
    resident_id: str,
    session: Session = Depends(get_session),
    admin: str = Depends(require_admin),
):
    resident = session.get(Resident, resident_id)
    if resident is None:
        raise HTTPException(status_code=404, detail="Unknown resident")
    in_loans = _count(session, Loan, (Loan.lender_id == resident_id) | (Loan.borrower_id == resident_id))
    in_handoffs = _count(session, Handoff, Handoff.recipient_id == resident_id)
    if in_loans or in_handoffs:
        raise HTTPException(
            status_code=409,
            detail="This resident has loans or handoffs on record, so removing them would break that history.",
        )
    for model, column in ((ShelfItem, ShelfItem.resident_id), (GroupBuyMember, GroupBuyMember.resident_id)):
        for row in session.exec(select(model).where(column == resident_id)).all():
            session.delete(row)
    session.delete(resident)
    _audit(session, admin, "resident.delete", "resident", resident_id, {"name": resident.name})
    session.commit()
    return {"deleted": resident_id}


@router.get("/loans")
def list_loans(
    status: str | None = None,
    session: Session = Depends(get_session),
    _admin: str = Depends(require_admin),
):
    if status is not None and status not in LOAN_STATUSES:
        raise HTTPException(status_code=422, detail="Unknown loan status")
    loans = session.exec(select(Loan).order_by(Loan.created_at.desc())).all()
    return [_loan_dict(loan) for loan in loans if status is None or loan.status == status]


@router.post("/loans/{loan_id}/cancel")
def cancel_loan(loan_id: str, session: Session = Depends(get_session), admin: str = Depends(require_admin)):
    loan = session.get(Loan, loan_id)
    if loan is None:
        raise HTTPException(status_code=404, detail="Unknown loan")
    if loan.status not in OPEN_LOAN_STATUSES:
        raise HTTPException(status_code=409, detail="Only a loan that is still open can be cancelled")
    previous = loan.status
    loan.status = "declined"
    session.add(loan)
    _audit(session, admin, "loan.cancel", "loan", loan_id, {"from": previous})
    session.commit()
    session.refresh(loan)
    return _loan_dict(loan)


@router.post("/loans/{loan_id}/force-return")
def force_return_loan(loan_id: str, session: Session = Depends(get_session), admin: str = Depends(require_admin)):
    result = return_loan(session, loan_id, None)
    _audit(session, admin, "loan.force_return", "loan", loan_id)
    session.commit()
    return result


@router.get("/requests")
def list_requests(session: Session = Depends(get_session), _admin: str = Depends(require_admin)):
    from app.logic import _public_request

    return [_public_request(row) | {"created_at": str(row.get("created_at") or "")} for row in _requests_for_activity(session)]


@router.post("/requests/{request_id}/close")
def close_request(request_id: str, session: Session = Depends(get_session), admin: str = Depends(require_admin)):
    local = session.get(Request, request_id)
    known = local is not None or any(row["id"] == request_id for row in _requests_for_activity(session))
    if not known:
        raise HTTPException(status_code=404, detail="Unknown request")
    _set_request_status(session, request_id, "closed")
    _audit(session, admin, "request.close", "request", request_id)
    session.commit()
    return {"id": request_id, "status": "closed"}


@router.get("/group-buys")
def list_group_buys(session: Session = Depends(get_session), _admin: str = Depends(require_admin)):
    return shared_demand(session)["group_buys"]


@router.delete("/group-buys/{catalog_item_id}")
def close_group_buy(catalog_item_id: str, session: Session = Depends(get_session), admin: str = Depends(require_admin)):
    rows = session.exec(select(GroupBuy).where(GroupBuy.catalog_item_id == catalog_item_id)).all()
    if not rows:
        raise HTTPException(status_code=404, detail="No group buy for that item")
    members = session.exec(select(GroupBuyMember).where(GroupBuyMember.catalog_item_id == catalog_item_id)).all()
    for row in [*rows, *members]:
        session.delete(row)
    _audit(session, admin, "group_buy.close", "group_buy", catalog_item_id, {"members": len(members)})
    session.commit()
    return {"closed": catalog_item_id, "members_removed": len(members)}


@router.get("/catalog")
def list_catalog(session: Session = Depends(get_session), _admin: str = Depends(require_admin)):
    rows = session.exec(select(CatalogItem).order_by(CatalogItem.name)).all()
    return [
        {
            "id": row.id,
            "name": row.name,
            "category": row.category,
            "demo_price_cents": row.demo_price_cents,
            "default_loan_hours": row.default_loan_hours,
        }
        for row in rows
    ]


@router.patch("/catalog/{item_id}")
def patch_catalog(
    item_id: str,
    body: CatalogPatch,
    session: Session = Depends(get_session),
    admin: str = Depends(require_admin),
):
    item = session.get(CatalogItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Unknown catalog item")
    changes = body.model_dump(exclude_none=True)
    if "name" in changes:
        changes["name"] = " ".join(changes["name"].split())
    for key, value in changes.items():
        setattr(item, key, value)
    session.add(item)
    _audit(session, admin, "catalog.update", "catalog", item_id, changes)
    session.commit()
    return {
        "id": item.id,
        "name": item.name,
        "category": item.category,
        "demo_price_cents": item.demo_price_cents,
        "default_loan_hours": item.default_loan_hours,
    }


@router.get("/audit")
def audit_log(limit: int = 100, session: Session = Depends(get_session), _admin: str = Depends(require_admin)):
    limit = max(1, min(limit, 500))
    rows = session.exec(select(AuditLog).order_by(AuditLog.at.desc()).limit(limit)).all()
    return [
        {
            "id": row.id,
            "at": row.at.astimezone(timezone.utc).isoformat() if isinstance(row.at, datetime) else str(row.at),
            "actor": row.actor,
            "action": row.action,
            "target_type": row.target_type,
            "target_id": row.target_id,
            "detail": json.loads(row.detail or "{}"),
        }
        for row in rows
    ]
