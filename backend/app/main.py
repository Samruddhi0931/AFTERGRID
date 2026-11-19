import hashlib
import json
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4
import secrets

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

# from app.database import (
#     AllocationApproval,
#     AllocationDraft,
#     ApprovedAllocation,
#     EmergencyRequest,
#     Inventory,
#     create_db_and_tables,
#     engine,
#     utc_now,
# )

from app.database import (
    DomainEvent,
    AllocationApproval,
    AllocationDraft,
    AllocationReceipt,
    ReceiptReissueAudit,
    ApprovedAllocation,
    EmergencyRequest,
    Inventory,
    create_db_and_tables,
    engine,
    utc_now,
)
from app.optimization.allocator import run_allocation
from app.journal import record_event


Resource = Literal["food", "water", "medicine"]
Urgency = Literal["normal", "high", "critical"]


class RequestInput(BaseModel):
    messageId: UUID
    type: Literal["RESOURCE_REQUEST"]
    householdId: str = Field(min_length=1, max_length=64)
    level: int = Field(ge=1, le=100)
    resource: Resource
    quantity: int = Field(gt=0)
    urgency: Urgency
    createdAt: datetime


class InventoryInput(BaseModel):
    resource: Resource
    available: int = Field(ge=0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    yield


app = FastAPI(
    title="HAVEN RationOS API",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type"],
)


# --------------------------------------------------
# Helpers
# --------------------------------------------------

def json_text(value: object) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
    )


def current_state(session: Session):
    """Return detached requests with remaining, not original, demand.

    Approved allocations reserve inventory immediately; collection is not
    subtracted again. The original EmergencyRequest is never modified.
    """
    from collections import defaultdict
    from sqlalchemy import func
    from sqlmodel import select

    sums = defaultdict(int)
    for message_id, amount in session.exec(
        select(ApprovedAllocation.message_id, func.sum(ApprovedAllocation.allocated))
        .group_by(ApprovedAllocation.message_id)
    ).all():
        sums[message_id] = int(amount or 0)

    originals = session.exec(select(EmergencyRequest)).all()
    requests = []
    remaining_state = []
    for original in sorted(originals, key=lambda r: str(r.message_id)):
        approved = sums[original.message_id]
        if approved < 0 or approved > original.quantity:
            raise HTTPException(status_code=409, detail="Invalid cumulative approved allocation")
        remaining = original.quantity - approved
        remaining_state.append({
            "message_id": str(original.message_id),
            "original_quantity": original.quantity,
            "approved_quantity": approved,
            "remaining_quantity": remaining,
        })
        if remaining:
            # Copy validated SQLModel fields into an independent, unsaved object.
            request = EmergencyRequest(
                message_id=original.message_id,
                household_id=original.household_id,
                level=original.level,
                resource=original.resource,
                quantity=remaining,
                urgency=original.urgency,
                created_at=original.created_at,
                received_at=original.received_at,
            )
            requests.append(request)

    inventory = sorted(session.exec(select(Inventory)).all(), key=lambda i: i.resource)
    state = {
        "requests": [{
            "message_id": str(item.message_id),
            "household_id": item.household_id,
            "level": item.level,
            "resource": item.resource,
            "quantity": item.quantity,
            "urgency": item.urgency,
            "created_at": item.created_at.isoformat(),
            "received_at": item.received_at.isoformat(),
        } for item in requests],
        "remaining_state": remaining_state,
        "inventory": [{"resource": i.resource, "available": i.available} for i in inventory],
    }
    return requests, inventory, hashlib.sha256(json_text(state).encode("utf-8")).hexdigest()


def draft_response(draft: AllocationDraft):
    result = json.loads(draft.result_json)

    return {
        **result,
        "draft_id": str(draft.draft_id),
        "status": draft.status,
        "created_at": draft.created_at.isoformat(),
        "decided_at": (
            draft.decided_at.isoformat()
            if draft.decided_at
            else None
        ),
        "approval_id": (
            str(draft.approval_id)
            if draft.approval_id
            else None
        ),
    }


def approval_response(approval: AllocationApproval):
    return {
        "approval_id": str(approval.approval_id),
        "draft_id": str(approval.draft_id),
        "approved_at": approval.approved_at.isoformat(),
        "status": "approved",
        "resources": json.loads(
            approval.allocation_snapshot
        ),
    }


def load_draft(session: Session, draft_id: UUID):
    draft = session.get(AllocationDraft, draft_id)

    if draft is None:
        raise HTTPException(
            status_code=404,
            detail="Allocation draft not found",
        )

    return draft


# --------------------------------------------------
# Health
# --------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "HAVEN RationOS",
    }


# --------------------------------------------------
# Emergency requests
# --------------------------------------------------

@app.post("/requests", status_code=201)
def create_request(payload: RequestInput):
    request = EmergencyRequest(
        message_id=payload.messageId,
        household_id=payload.householdId,
        level=payload.level,
        resource=payload.resource,
        quantity=payload.quantity,
        urgency=payload.urgency,
        created_at=payload.createdAt,
    )

    with Session(engine) as session:
        session.add(request)
        record_event(session, "REQUEST_RECEIVED", str(request.message_id), {"resource": request.resource, "quantity": request.quantity}, operation_id="request:" + str(request.message_id))

        try:
            session.commit()
        except IntegrityError as error:
            session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Request already exists",
            ) from error

        session.refresh(request)
        return request


@app.get("/requests")
def list_requests():
    with Session(engine) as session:
        return session.exec(
            select(EmergencyRequest).order_by(
                EmergencyRequest.received_at.desc()
            )
        ).all()


# --------------------------------------------------
# Inventory
# --------------------------------------------------

@app.put("/inventory")
def update_inventory(payload: InventoryInput):
    with Session(engine) as session:
        inventory = session.get(
            Inventory,
            payload.resource,
        )

        if inventory is None:
            inventory = Inventory(
                resource=payload.resource,
                available=payload.available,
            )
        else:
            inventory.available = payload.available

        session.add(inventory)
        record_event(session, "INVENTORY_SET", payload.resource, {"available": payload.available})
        session.commit()
        session.refresh(inventory)

        return inventory


@app.get("/inventory")
def list_inventory():
    with Session(engine) as session:
        return session.exec(select(Inventory)).all()


# --------------------------------------------------
# Generate and persist draft
# --------------------------------------------------

@app.post("/allocate")
def calculate_allocation():
    """
    Generate a persistent draft.

    No inventory is deducted.
    """

    with Session(engine) as session:
        requests, inventory, fingerprint = current_state(
            session
        )

        result = run_allocation(
            requests=requests,
            inventory=inventory,
        )

        if not any(
            result["resources"][resource]["optimized"]["allocated"] > 0
            for resource in ("food", "water", "medicine")
        ):
            raise HTTPException(
                status_code=409,
                detail="No positive allocations available. Add inventory or new requests.",
            )

        draft = AllocationDraft(
            draft_id=uuid4(),
            status="pending",
            result_json=json_text(result),
            state_hash=fingerprint,
        )

        session.add(draft)
        record_event(session, "DRAFT_CREATED", str(draft.draft_id), {"state_hash": fingerprint}, operation_id="draft:" + str(draft.draft_id))
        session.commit()
        session.refresh(draft)

        return draft_response(draft)


@app.get("/drafts")
def list_drafts():
    with Session(engine) as session:
        drafts = session.exec(
            select(AllocationDraft).order_by(
                AllocationDraft.created_at.desc()
            )
        ).all()

        return [draft_response(item) for item in drafts]


@app.get("/drafts/{draft_id}")
def get_draft(draft_id: UUID):
    with Session(engine) as session:
        draft = load_draft(session, draft_id)
        return draft_response(draft)


# --------------------------------------------------
# Approve draft
# --------------------------------------------------

@app.post("/drafts/{draft_id}/approve")
def approve_draft(draft_id: UUID):
    """
    Atomically approve a pending draft.

    Repeated approval of an already-approved
    draft returns the existing approval.

    A stale or rejected draft cannot be approved.
    """

    # BEGIN IMMEDIATE obtains SQLite's write reservation
    # before reading the draft and current inventory.
    with engine.connect() as connection:
        connection.exec_driver_sql("BEGIN IMMEDIATE")

        try:
            with Session(bind=connection) as session:
                draft = load_draft(session, draft_id)

                # Idempotent retry: no second deduction.
                if draft.status == "approved":
                    if draft.approval_id is None:
                        raise HTTPException(
                            status_code=500,
                            detail="Approved draft has no approval record",
                        )

                    existing = session.get(
                        AllocationApproval,
                        draft.approval_id,
                    )

                    if existing is None:
                        raise HTTPException(
                            status_code=500,
                            detail="Approval record missing",
                        )

                    response = approval_response(existing)

                else:
                    if draft.status != "pending":
                        raise HTTPException(
                            status_code=409,
                            detail="Draft is not pending",
                        )

                    requests, inventory, fingerprint = (
                        current_state(session)
                    )

                    if fingerprint != draft.state_hash:
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                "Draft is stale. Requests or "
                                "inventory changed. Run RationOS again."
                            ),
                        )

                    # Recalculate server-side rather than
                    # trusting quantities from the client.
                    recalculated = run_allocation(
                        requests=requests,
                        inventory=inventory,
                    )

                    stored_result = json.loads(
                        draft.result_json
                    )

                    if (
                        json_text(recalculated)
                        != json_text(stored_result)
                    ):
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                "Draft differs from the current "
                                "solver result. Run RationOS again."
                            ),
                        )

                    inventory_map = {
                        item.resource: item
                        for item in inventory
                    }

                    request_map = {
                        str(item.message_id): item
                        for item in requests
                    }

                    approval_id = uuid4()
                    approved_at = utc_now()
                    approved_rows = []
                    seen_ids = set()

                    for resource in [
                        "food",
                        "water",
                        "medicine",
                    ]:
                        resource_result = (
                            recalculated["resources"][resource]
                        )

                        optimized = resource_result["optimized"]

                        allocated_total = 0

                        for item in optimized["allocations"]:
                            message_id = item["message_id"]

                            if message_id in seen_ids:
                                raise HTTPException(
                                    status_code=409,
                                    detail="Duplicate request in draft",
                                )

                            seen_ids.add(message_id)

                            request = request_map.get(message_id)

                            if (
                                request is None
                                or request.resource != resource
                                or item["requested"] != request.quantity
                            ):
                                raise HTTPException(
                                    status_code=409,
                                    detail="Draft request mismatch",
                                )

                            amount = item["allocated"]

                            if (
                                not isinstance(amount, int)
                                or isinstance(amount, bool)
                                or amount < 0
                                or amount > request.quantity
                            ):
                                raise HTTPException(
                                    status_code=409,
                                    detail="Invalid allocation quantity",
                                )

                            allocated_total += amount

                            approved_rows.append(
                                ApprovedAllocation(
                                    allocation_id=uuid4(),
                                    message_id=request.message_id,
                                    approval_id=approval_id,
                                    household_id=request.household_id,
                                    resource=resource,
                                    requested=request.quantity,
                                    allocated=amount,
                                    created_at=approved_at,
                                )
                            )

                        stock = inventory_map.get(resource)
                        available = (
                            stock.available if stock else 0
                        )

                        if allocated_total > available:
                            raise HTTPException(
                                status_code=409,
                                detail=(
                                    f"Insufficient {resource} inventory"
                                ),
                            )

                        if stock is not None:
                            stock.available -= allocated_total
                            session.add(stock)

                    if len(seen_ids) != len(requests):
                        raise HTTPException(
                            status_code=409,
                            detail="Draft does not cover all pending requests",
                        )

                    if not any(row.allocated > 0 for row in approved_rows):
                        raise HTTPException(
                            status_code=409,
                            detail="No positive allocations to approve. Add stock or new requests.",
                        )

                    for row in approved_rows:
                        session.add(row)

                    approval = AllocationApproval(
                        approval_id=approval_id,
                        draft_id=draft.draft_id,
                        approved_at=approved_at,
                        allocation_snapshot=json_text(
                            recalculated["resources"]
                        ),
                    )

                    session.add(approval)

                    draft.status = "approved"
                    draft.decided_at = approved_at
                    draft.approval_id = approval_id

                    session.add(draft)
                    record_event(session, "ALLOCATION_APPROVED", str(approval_id), {"draft_id": str(draft.draft_id), "allocations": [{"message_id": str(r.message_id), "resource": r.resource, "allocated": r.allocated} for r in approved_rows]}, operation_id="approval:" + str(approval_id))
                    session.flush()

                    response = approval_response(approval)

            connection.commit()
            return response

        except Exception:
            connection.rollback()
            raise


# --------------------------------------------------
# Reject draft
# --------------------------------------------------

@app.post("/drafts/{draft_id}/reject")
def reject_draft(draft_id: UUID):
    with engine.connect() as connection:
        connection.exec_driver_sql("BEGIN IMMEDIATE")

        try:
            with Session(bind=connection) as session:
                draft = load_draft(session, draft_id)

                if draft.status == "approved":
                    raise HTTPException(
                        status_code=409,
                        detail="Approved drafts cannot be rejected",
                    )

                if draft.status == "pending":
                    draft.status = "rejected"
                    draft.decided_at = utc_now()
                    session.add(draft)
                    record_event(session, "DRAFT_REJECTED", str(draft_id), {}, operation_id="reject:" + str(draft_id))
                    session.flush()

                response = draft_response(draft)

            connection.commit()
            return response

        except Exception:
            connection.rollback()
            raise


# --------------------------------------------------
# Approval history
# --------------------------------------------------

@app.get("/approvals")
def list_approvals():
    with Session(engine) as session:
        approvals = session.exec(
            select(AllocationApproval).order_by(
                AllocationApproval.approved_at.desc()
            )
        ).all()

        return [
            approval_response(item)
            for item in approvals
        ]

# --------------------------------------------------
# Step 12.3A — Issue allocation receipts
# --------------------------------------------------

@app.post("/approvals/{approval_id}/receipts", status_code=201)
def issue_allocation_receipts(approval_id: UUID):
    """
    Issue one receipt for each positive approved allocation.

    Tokens are returned once and only their hashes
    are stored in SQLite.

    A repeated issuance request is rejected rather
    than creating duplicate receipts.
    """

    with engine.connect() as connection:
        connection.exec_driver_sql("BEGIN IMMEDIATE")

        try:
            with Session(bind=connection) as session:
                approval = session.get(
                    AllocationApproval,
                    approval_id,
                )

                if approval is None:
                    raise HTTPException(
                        status_code=404,
                        detail="Approval not found",
                    )

                allocations = session.exec(
                    select(ApprovedAllocation).where(
                        ApprovedAllocation.approval_id
                        == approval_id
                    )
                ).all()

                # A zero-unit allocation does not
                # create a collection entitlement.
                eligible = [
                    item
                    for item in allocations
                    if item.allocated > 0
                ]

                eligible.sort(
                    key=lambda item: str(item.message_id)
                )

                if not eligible:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "This approval contains no "
                            "positive allocations."
                        ),
                    )

                existing = session.exec(
                    select(AllocationReceipt).where(
                        AllocationReceipt.approval_id
                        == approval_id
                    )
                ).all()

                if existing:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Receipts already issued for "
                            "this approval. Original tokens "
                            "cannot be retrieved."
                        ),
                    )

                response_receipts = []

                for allocation in eligible:
                    # 32 random bytes = 256 bits.
                    token = secrets.token_urlsafe(32)

                    token_hash = hashlib.sha256(
                        token.encode("utf-8")
                    ).hexdigest()

                    receipt = AllocationReceipt(
                        receipt_id=uuid4(),
                        allocation_id=allocation.allocation_id,
                        message_id=allocation.message_id,
                        approval_id=approval_id,
                        token_hash=token_hash,
                        status="issued",
                    )

                    session.add(receipt)

                    response_receipts.append({
                        "receipt_id": str(receipt.receipt_id),
                        "allocation_id": str(allocation.allocation_id),
                        "message_id": str(
                            allocation.message_id
                        ),
                        "household_id": (
                            allocation.household_id
                        ),
                        "resource": allocation.resource,
                        "quantity": allocation.allocated,
                        "status": "issued",
                        "token": token,
                    })

                record_event(session, "RECEIPTS_ISSUED", str(approval_id), {"receipt_ids": [r["receipt_id"] for r in response_receipts]}, operation_id="issue:" + str(approval_id))
                session.flush()

                response = {
                    "approval_id": str(approval_id),
                    "status": "issued",
                    "receipt_count": len(
                        response_receipts
                    ),
                    "receipts": response_receipts,
                }

            connection.commit()
            return response

        except Exception:
            connection.rollback()
            raise


@app.get("/approvals/{approval_id}/receipts")
def list_allocation_receipts(approval_id: UUID):
    """
    Return receipt metadata without exposing tokens.
    """

    with Session(engine) as session:
        approval = session.get(
            AllocationApproval,
            approval_id,
        )

        if approval is None:
            raise HTTPException(
                status_code=404,
                detail="Approval not found",
            )

        receipts = session.exec(
            select(AllocationReceipt).where(
                AllocationReceipt.approval_id
                == approval_id
            )
        ).all()

        return {
            "approval_id": str(approval_id),
            "receipt_count": len(receipts),
            "receipts": [
                {
                    "receipt_id": str(item.receipt_id),
                    "allocation_id": str(item.allocation_id),
                    "message_id": str(item.message_id),
                    "household_id": (session.get(ApprovedAllocation, item.allocation_id).household_id
                                     if session.get(ApprovedAllocation, item.allocation_id) else None),
                    "resource": (session.get(ApprovedAllocation, item.allocation_id).resource
                                 if session.get(ApprovedAllocation, item.allocation_id) else None),
                    "quantity": (session.get(ApprovedAllocation, item.allocation_id).allocated
                                 if session.get(ApprovedAllocation, item.allocation_id) else None),
                    "status": item.status,
                    "issued_at": item.issued_at.isoformat(),
                    "collected_at": (
                        item.collected_at.isoformat()
                        if item.collected_at
                        else None
                    ),
                }
                for item in receipts
            ],
        }


class ReceiptReissueInput(BaseModel):
    reason: str = Field(min_length=8, max_length=300)


@app.post("/receipts/{receipt_id}/reissue")
def reissue_receipt(receipt_id: UUID, payload: ReceiptReissueInput):
    """Atomically rotate the bearer token. Old QR becomes invalid immediately.

    Requires coordinator authorization before any real-world deployment.
    Never reissue a collected entitlement.
    """
    with engine.connect() as connection:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            with Session(bind=connection) as session:
                receipt = session.get(AllocationReceipt, receipt_id)
                if receipt is None:
                    raise HTTPException(status_code=404, detail="Receipt not found")
                if receipt.status != "issued" or receipt.collected_at is not None:
                    raise HTTPException(status_code=409, detail="Only uncollected issued receipts can be reissued")
                allocation = session.get(ApprovedAllocation, receipt.allocation_id)
                if allocation is None or allocation.allocated <= 0:
                    raise HTTPException(status_code=409, detail="Approved entitlement missing")
                token = secrets.token_urlsafe(32)
                receipt.token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
                receipt.issued_at = utc_now()
                session.add(receipt)
                session.add(ReceiptReissueAudit(
                    event_id=uuid4(), receipt_id=receipt.receipt_id,
                    approval_id=receipt.approval_id,
                    reason=payload.reason.strip(),
                ))
                record_event(session, "RECEIPT_REISSUED", str(receipt.receipt_id), {"approval_id": str(receipt.approval_id), "reason": payload.reason.strip()})
                session.flush()
                response = {
                    "approval_id": str(receipt.approval_id),
                    "receipt": {
                        "receipt_id": str(receipt.receipt_id),
                        "allocation_id": str(allocation.allocation_id),
                        "message_id": str(receipt.message_id),
                        "household_id": allocation.household_id,
                        "resource": allocation.resource,
                        "quantity": allocation.allocated,
                        "status": "issued",
                        "token": token,
                    },
                }
            connection.commit()
            return response
        except Exception:
            connection.rollback()
            raise


# --------------------------------------------------
# Step 12.4 — Verify and redeem one-time collection tokens
# --------------------------------------------------
class CollectionTokenInput(BaseModel):
    token: str = Field(min_length=20, max_length=256)


def receipt_collection_details(session: Session, receipt: AllocationReceipt):
    allocation = session.get(ApprovedAllocation, receipt.allocation_id)
    if allocation is None or allocation.allocated <= 0 or allocation.approval_id != receipt.approval_id:
        raise HTTPException(status_code=409, detail="Approved entitlement missing")
    return {
        "receipt_id": str(receipt.receipt_id),
        "allocation_id": str(allocation.allocation_id),
        "approval_id": str(receipt.approval_id),
        "message_id": str(receipt.message_id),
        "household_id": allocation.household_id,
        "resource": allocation.resource,
        "quantity": allocation.allocated,
        "status": receipt.status,
        "collected_at": receipt.collected_at.isoformat() if receipt.collected_at else None,
    }


def lookup_collection_receipt(session: Session, token: str):
    # The database contains only SHA-256 token hashes, not bearer tokens.
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    receipt = session.exec(
        select(AllocationReceipt).where(AllocationReceipt.token_hash == token_hash)
    ).first()
    if receipt is None:
        # Includes lost/replaced tokens. Avoid revealing which kind it was.
        raise HTTPException(status_code=404, detail="Invalid or replaced receipt token")
    return receipt


@app.post("/receipts/verify")
def verify_collection_token(payload: CollectionTokenInput):
    """Read-only verification; does not hand over or deduct stock."""
    with Session(engine) as session:
        receipt = lookup_collection_receipt(session, payload.token)
        details = receipt_collection_details(session, receipt)
        if receipt.status == "collected" or receipt.collected_at is not None:
            raise HTTPException(status_code=409, detail="Receipt already collected")
        if receipt.status != "issued":
            raise HTTPException(status_code=409, detail="Receipt is not valid for collection")
        return details


@app.post("/receipts/collect")
def collect_receipt(payload: CollectionTokenInput):
    """Atomically mark one receipt collected; never deduct inventory again.

    Requires authenticated volunteer authorization before production use.
    """
    with engine.connect() as connection:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            with Session(bind=connection) as session:
                receipt = lookup_collection_receipt(session, payload.token)
                receipt_collection_details(session, receipt)
                if receipt.status == "collected" or receipt.collected_at is not None:
                    raise HTTPException(status_code=409, detail="Receipt already collected")
                if receipt.status != "issued":
                    raise HTTPException(status_code=409, detail="Receipt is not valid for collection")
                receipt.status = "collected"
                receipt.collected_at = utc_now()
                session.add(receipt)
                record_event(session, "RECEIPT_COLLECTED", str(receipt.receipt_id), {"approval_id": str(receipt.approval_id)}, operation_id="collect:" + str(receipt.receipt_id))
                session.flush()
                response = receipt_collection_details(session, receipt)
            connection.commit()
            return response
        except Exception:
            connection.rollback()
            raise


@app.get("/resilience/events")
def list_domain_events(limit: int = 50):
    """Local diagnostic endpoint. Restrict access before deployment."""
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=422, detail="limit must be 1..200")
    with Session(engine) as session:
        events = session.exec(select(DomainEvent).order_by(DomainEvent.occurred_at.desc()).limit(limit)).all()
        return [{"event_id": str(e.event_id), "event_type": e.event_type,
                 "aggregate_id": e.aggregate_id, "operation_id": e.operation_id,
                 "occurred_at": e.occurred_at.isoformat(),
                 "payload": json.loads(e.payload_json)} for e in events]
