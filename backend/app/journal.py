"""Atomic, append-only local audit events. Not a replicated consensus log."""
import json
from uuid import uuid4
from sqlmodel import Session
from typing import Optional
from app.database import DomainEvent

def record_event(session: Session, event_type: str, aggregate_id: str, payload: dict, operation_id: Optional[str] = None):
    event = DomainEvent(
        event_id=uuid4(), event_type=event_type, aggregate_id=str(aggregate_id),
        operation_id=operation_id or str(uuid4()),
        payload_json=json.dumps(payload, sort_keys=True, separators=(",", ":")),
    )
    session.add(event)
    return event
