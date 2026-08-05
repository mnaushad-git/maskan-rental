"""Thin helper around `AuditLog` so call sites read as one line. Like
`app.core.outbox.record_event`, this only `db.add()`s — it never commits —
so the audit row lands in the same transaction as the action it describes
(a rollback discards both together)."""
from typing import Any

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog


def record_audit(
    db: Session,
    *,
    user_id: int | None,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    metadata: dict | None = None,
) -> AuditLog:
    entry = AuditLog(
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        extra_metadata=metadata or {},
    )
    db.add(entry)
    return entry
