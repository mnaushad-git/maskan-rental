"""Deterministic district/area recommendations for a Property Request
(Phase 5). Ranking is pure Python/SQL — the AI Property Agent may narrate
*why* an area was suggested, but never decides the ranking itself (Phase 5:
"The core ranking must be deterministic. AI may explain the result but
should not be the sole ranking mechanism.").
"""
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.area_intelligence import AreaIntelligence
from app.models.property import Property
from app.models.property_request import PropertyRequest
from app.services.property_request_matcher import _haversine_km

LABELS = ("best_overall", "best_value", "best_commute", "best_family", "premium", "flexible_alternative")


@dataclass
class AreaSuggestion:
    area_name: str
    city: str
    fit_score: float
    label: str
    typical_price_range: tuple[float | None, float | None] | None
    estimated_availability: int
    commute_estimate_minutes: float | None
    reasons: list[str]
    trade_offs: list[str]
    data_confidence: float


def _price_stats(db: Session, pr: PropertyRequest, area_name: str) -> tuple[float | None, float | None, float | None, int]:
    price_col = Property.sale_price if pr.transaction_type == "sale" else Property.monthly_rent
    stmt = select(func.min(price_col), func.max(price_col), func.avg(price_col), func.count(Property.id)).where(
        Property.area.ilike(area_name), Property.city.ilike(pr.city), Property.status == "Published"
    )
    if pr.transaction_type:
        stmt = stmt.where(Property.listing_type == pr.transaction_type)
    row = db.execute(stmt).first()
    return (row[0], row[1], row[2], row[3] or 0) if row else (None, None, None, 0)


def suggest_areas(db: Session, pr: PropertyRequest, *, limit: int = 6) -> list[AreaSuggestion]:
    if not pr.city:
        return []
    excluded = {d.lower() for d in (pr.excluded_districts or [])}
    rows = db.scalars(select(AreaIntelligence).where(AreaIntelligence.city.ilike(pr.city))).all()

    scored: list[dict] = []
    for row in rows:
        if row.area_name.lower() in excluded:
            continue
        min_p, max_p, avg_p, availability = _price_stats(db, pr, row.area_name)

        budget_score = 0.5
        if pr.max_price and avg_p:
            budget_score = max(0.0, min(1.0, 1.2 - avg_p / pr.max_price)) if avg_p <= pr.max_price * 1.3 else 0.0

        commute_minutes = None
        commute_score = 0.5
        if pr.max_commute_minutes and pr.commute_destination_lat is not None and row.center_lat is not None:
            km = _haversine_km(row.center_lat, row.center_lng, pr.commute_destination_lat, pr.commute_destination_lng)
            commute_minutes = round((km / 30.0) * 60)
            commute_score = max(0.0, min(1.0, 1.0 - commute_minutes / (pr.max_commute_minutes * 1.5)))

        if pr.school_preference and row.school_score is not None:
            lifestyle_score = row.school_score / 100
        elif pr.hospital_preference and row.healthcare_score is not None:
            lifestyle_score = row.healthcare_score / 100
        elif pr.family_size and row.family_score is not None:
            lifestyle_score = row.family_score / 100
        else:
            lifestyle_score = (row.area_score or 50) / 100

        availability_score = min(1.0, availability / 10)
        fit_score = round(0.30 * budget_score + 0.25 * lifestyle_score + 0.25 * commute_score + 0.20 * availability_score, 4)

        reasons = []
        trade_offs = []
        if budget_score >= 0.6:
            reasons.append("within_budget_range")
        elif avg_p:
            trade_offs.append("above_typical_budget")
        if commute_minutes is not None and commute_minutes <= (pr.max_commute_minutes or 9999):
            reasons.append("good_commute")
        elif commute_minutes is not None:
            trade_offs.append("longer_commute")
        if lifestyle_score >= 0.7:
            reasons.append("strong_lifestyle_fit")
        if availability == 0:
            trade_offs.append("no_current_listings")

        scored.append({
            "row": row, "fit_score": fit_score, "min_p": min_p, "max_p": max_p, "availability": availability,
            "commute_minutes": commute_minutes, "reasons": reasons, "trade_offs": trade_offs,
            "data_confidence": round((0.5 if avg_p else 0.2) + (0.3 if commute_minutes is not None else 0) + (0.2 if row.area_score is not None else 0), 2),
            "preferred": row.area_name.lower() in {d.lower() for d in (pr.preferred_districts or [])},
        })

    if not scored:
        return []
    scored.sort(key=lambda s: s["fit_score"], reverse=True)
    top = scored[:limit]

    labels: dict[int, str] = {}
    labels[0] = "best_overall"
    by_value = sorted(top, key=lambda s: (s["min_p"] if s["min_p"] is not None else float("inf")))
    if by_value:
        labels.setdefault(top.index(by_value[0]), "best_value")
    by_commute = [s for s in top if s["commute_minutes"] is not None]
    if by_commute:
        best_commute = min(by_commute, key=lambda s: s["commute_minutes"])
        labels.setdefault(top.index(best_commute), "best_commute")
    by_family = sorted(top, key=lambda s: (s["row"].family_score or 0), reverse=True)
    if by_family:
        labels.setdefault(top.index(by_family[0]), "best_family")
    by_premium = sorted(top, key=lambda s: (s["max_p"] if s["max_p"] is not None else 0), reverse=True)
    if by_premium:
        labels.setdefault(top.index(by_premium[0]), "premium")
    for i, s in enumerate(top):
        if i not in labels and not s["preferred"]:
            labels[i] = "flexible_alternative"
            break

    results = []
    for i, s in enumerate(top):
        results.append(
            AreaSuggestion(
                area_name=s["row"].area_name,
                city=s["row"].city,
                fit_score=s["fit_score"],
                label=labels.get(i, "flexible_alternative"),
                typical_price_range=(s["min_p"], s["max_p"]),
                estimated_availability=s["availability"],
                commute_estimate_minutes=s["commute_minutes"],
                reasons=s["reasons"],
                trade_offs=s["trade_offs"],
                data_confidence=s["data_confidence"],
            )
        )
    return results
