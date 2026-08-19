"""Property Intelligence — Comparable Properties. Deterministic, no LLM.
Extends `app.api.routes.properties.get_similar_properties`'s query shape
(same city + Published + price-proximity ordering) rather than inventing a
new comparable-selection style, adding: transaction-type match, a
district-first ordering tier, eager-loaded `listing_images` (avoids N+1 when
callers render comparable cards), and the richer per-result fields Property
Intelligence needs (price difference, price/sqm, match-similarity %, value
label).
"""
from dataclasses import dataclass

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, selectinload

from app.models.property import Property

MAX_COMPARABLES = 10
_SIMILAR_SIZE_BAND = 0.20  # +/-20%
_SIMILAR_PRICE_BAND = 0.20  # +/-20%
_VALUE_LABEL_THRESHOLD = 0.05  # +/-5% price difference


def _price_for(prop: Property) -> float | None:
    return prop.sale_price if prop.listing_type == "sale" else prop.monthly_rent


@dataclass
class ComparableProperty:
    property: Property
    price_difference: float | None
    price_per_sqm: float | None
    match_similarity_percent: int
    value_label: str | None


def _match_similarity(subject: Property, candidate: Property) -> int:
    considered = 0
    matched = 0

    if subject.area:
        considered += 1
        if (candidate.area or "").strip().lower() == subject.area.strip().lower():
            matched += 1

    if subject.property_type:
        considered += 1
        if candidate.property_type == subject.property_type:
            matched += 1

    if subject.bedrooms is not None:
        considered += 1
        if candidate.bedrooms == subject.bedrooms:
            matched += 1

    if subject.size_sq_m:
        considered += 1
        if candidate.size_sq_m and abs(candidate.size_sq_m - subject.size_sq_m) <= subject.size_sq_m * _SIMILAR_SIZE_BAND:
            matched += 1

    subject_price = _price_for(subject)
    if subject_price:
        considered += 1
        candidate_price = _price_for(candidate)
        if candidate_price and abs(candidate_price - subject_price) <= subject_price * _SIMILAR_PRICE_BAND:
            matched += 1

    if considered == 0:
        return 0
    return round(matched / considered * 100)


def _value_label(subject: Property, candidate: Property) -> str | None:
    subject_price = _price_for(subject)
    candidate_price = _price_for(candidate)
    if not subject_price or not candidate_price:
        return None
    pct_diff = (candidate_price - subject_price) / subject_price
    if pct_diff <= -_VALUE_LABEL_THRESHOLD:
        return "Better Value"
    if pct_diff >= _VALUE_LABEL_THRESHOLD:
        return "Higher Price"
    return "Similar Price"


def find_comparable_properties(db: Session, subject: Property, limit: int = MAX_COMPARABLES) -> list[ComparableProperty]:
    limit = min(limit, MAX_COMPARABLES)
    subject_price = _price_for(subject)
    price_col = Property.sale_price if subject.listing_type == "sale" else Property.monthly_rent

    stmt = (
        select(Property)
        .options(selectinload(Property.listing_images))
        .where(
            Property.id != subject.id,
            Property.status == "Published",
            Property.city == subject.city,
            Property.listing_type == subject.listing_type,
        )
        .order_by(
            case((Property.area == subject.area, 0), else_=1),
            func.abs(func.coalesce(price_col, 0) - (subject_price or 0)),
        )
        .limit(limit)
    )
    candidates = list(db.scalars(stmt).all())

    results = []
    for candidate in candidates:
        candidate_price = _price_for(candidate)
        price_difference = (candidate_price - subject_price) if (candidate_price is not None and subject_price is not None) else None
        price_per_sqm = (
            round(candidate.sale_price / candidate.size_sq_m, 2)
            if subject.listing_type == "sale" and candidate.sale_price and candidate.size_sq_m
            else None
        )
        results.append(
            ComparableProperty(
                property=candidate,
                price_difference=price_difference,
                price_per_sqm=price_per_sqm,
                match_similarity_percent=_match_similarity(subject, candidate),
                value_label=_value_label(subject, candidate),
            )
        )
    return results
