from datetime import datetime, timezone


def expire_stale_assignments() -> None:
    """
    Mark pending LeadAssignments past their expires_at as 'expired',
    revert the lead to 'open', and trigger re-assignment.
    Runs every 30 minutes via APScheduler.
    """
    from app.db.session import SessionLocal
    from app.models.lead import Lead, LeadAssignment

    db = SessionLocal()
    reassign_jobs: list[tuple[int, list[int]]] = []
    try:
        now = datetime.now(timezone.utc)
        stale = (
            db.query(LeadAssignment)
            .filter(LeadAssignment.status == "pending", LeadAssignment.expires_at < now)
            .all()
        )
        if not stale:
            return

        affected_lead_ids: set[int] = set()
        for assignment in stale:
            assignment.status = "expired"
            affected_lead_ids.add(assignment.lead_id)

        for lead_id in affected_lead_ids:
            lead = db.get(Lead, lead_id)
            if lead and lead.status in ("open", "assigned"):
                lead.status = "open"

        db.commit()

        # Collect re-assignment args while session is still open
        for lead_id in affected_lead_ids:
            lead = db.get(Lead, lead_id)
            if lead and lead.status == "open":
                already_tried = [a.mediator_id for a in lead.assignments if a.mediator_id]
                reassign_jobs.append((lead_id, already_tried))
    finally:
        db.close()

    # _reassign_lead opens its own session — call after closing ours
    from app.api.routes.leads import _reassign_lead
    for lead_id, exclude_ids in reassign_jobs:
        _reassign_lead(lead_id, exclude_ids)
