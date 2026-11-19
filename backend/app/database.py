from datetime import datetime, timezone
from uuid import UUID, uuid4
from typing import Optional
from sqlmodel import Field, SQLModel, create_engine

DATABASE_URL = "sqlite:///./haven.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class EmergencyRequest(SQLModel, table=True):
    __tablename__ = "emergency_requests"
    message_id: UUID = Field(primary_key=True)
    household_id: str = Field(index=True)
    level: int
    resource: str = Field(index=True)
    quantity: int
    urgency: str
    created_at: datetime
    received_at: datetime = Field(default_factory=utc_now)

class Inventory(SQLModel, table=True):
    __tablename__ = "inventory"
    resource: str = Field(primary_key=True)
    available: int = Field(default=0, ge=0)

class AllocationDraft(SQLModel, table=True):
    __tablename__ = "allocation_drafts"
    draft_id: UUID = Field(primary_key=True)
    status: str = Field(default="pending", index=True)
    created_at: datetime = Field(default_factory=utc_now)
    decided_at: Optional[datetime] = Field(default=None)
    result_json: str
    state_hash: str
    approval_id: Optional[UUID] = Field(default=None)

class AllocationApproval(SQLModel, table=True):
    __tablename__ = "allocation_approvals"
    approval_id: UUID = Field(primary_key=True)
    draft_id: UUID = Field(index=True, unique=True)
    approved_at: datetime = Field(default_factory=utc_now)
    allocation_snapshot: str

class ApprovedAllocation(SQLModel, table=True):
    __tablename__ = "approved_allocations"
    allocation_id: UUID = Field(default_factory=uuid4, primary_key=True)
    message_id: UUID = Field(index=True)
    approval_id: UUID = Field(index=True)
    household_id: str
    resource: str
    requested: int
    allocated: int = Field(ge=0)
    created_at: datetime = Field(default_factory=utc_now)

class AllocationReceipt(SQLModel, table=True):
    __tablename__ = "allocation_receipts"
    receipt_id: UUID = Field(primary_key=True)
    allocation_id: UUID = Field(index=True, unique=True, foreign_key="approved_allocations.allocation_id")
    message_id: UUID = Field(index=True)
    approval_id: UUID = Field(index=True)
    token_hash: str = Field(index=True, unique=True)
    status: str = Field(default="issued", index=True)
    issued_at: datetime = Field(default_factory=utc_now)
    collected_at: Optional[datetime] = Field(default=None)

class ReceiptReissueAudit(SQLModel, table=True):
    __tablename__ = "receipt_reissue_audit"
    event_id: UUID = Field(primary_key=True)
    receipt_id: UUID = Field(index=True)
    approval_id: UUID = Field(index=True)
    reissued_at: datetime = Field(default_factory=utc_now)
    reason: str

class DomainEvent(SQLModel, table=True):
    __tablename__ = "domain_events"
    event_id: UUID = Field(primary_key=True)
    event_type: str = Field(index=True)
    aggregate_id: str = Field(index=True)
    operation_id: str = Field(index=True, unique=True)
    occurred_at: datetime = Field(default_factory=utc_now)
    payload_json: str
    schema_version: int = Field(default=1)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
