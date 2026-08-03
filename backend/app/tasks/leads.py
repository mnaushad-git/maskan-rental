"""Lead-related background work: matching newly-created leads against
published properties. Runs on the `default` queue (see app/core/celery_app.py).
"""
import logging

from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.db.session import SessionLocal
from app.models.lead import Lead, LeadSuggestion
from app.models.property import Property

logger = logging.getLogger("app.tasks.leads")


def suggest_properties(lead: Lead, db: Session) -> list[LeadSuggestion]:
    """Find up to 10 matching published properties for a lead."""
    q = db.query(Property).filter(
        Property.area.ilike(lead.area_name),
        Property.status == "Published",
    )
    if lead.max_budget is not None:
        q = q.filter(Property.monthly_rent <= lead.max_budget)
    if lead.bedrooms_needed is not None:
        q = q.filter(Property.bedrooms == lead.bedrooms_needed)
    properties = q.order_by(Property.created_at.desc()).limit(10).all()

    suggestions = []
    for prop in properties:
        score = 100.0
        if lead.max_budget and prop.monthly_rent > lead.max_budget * 0.95:
            score -= 20
        if lead.bedrooms_needed and prop.bedrooms != lead.bedrooms_needed:
            score -= 15
        reason = f"Published in {prop.area}"
        if lead.bedrooms_needed and prop.bedrooms == lead.bedrooms_needed:
            reason += f" · {prop.bedrooms} BR match"
        suggestions.append(LeadSuggestion(lead_id=lead.id, property_id=prop.id, match_score=max(0.0, score), reason=reason))
    return suggestions


@celery_app.task(
    name="app.tasks.leads.generate_lead_suggestions",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
)
def generate_lead_suggestions(self, lead_id: int) -> int:
    """Populate matched-property suggestions for a newly-created lead.
    Idempotent-ish: re-running for the same lead_id just adds another batch
    of suggestions rather than erroring, so a retry after a transient DB
    error is safe (at worst it duplicates suggestion rows, which is a cosmetic
    concern, not a correctness one — no money or lead state is affected)."""
    db = SessionLocal()
    try:
        lead = db.get(Lead, lead_id)
        if not lead:
            logger.warning("generate_lead_suggestions(%s): lead not found, skipping", lead_id)
            return 0
        suggestions = suggest_properties(lead, db)
        for s in suggestions:
            db.add(s)
        db.commit()
        return len(suggestions)
    finally:
        db.close()
