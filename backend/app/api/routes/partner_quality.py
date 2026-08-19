"""Partner Listing Quality (Prompt 3) — listing completeness + image-quality
signals for the mediator's own listing, the "Confirm Availability" action
(writes Prompt 2's `Property.availability_confirmed_at` column), and
"Improve with AI" wording suggestions the partner must explicitly approve
(never auto-saved). Every endpoint here is permission-checked to the owning
mediator via `get_mediator_user`, mirroring the exact ownership-check
pattern `properties.py`'s existing `/partner/{property_id}` routes already
use (404 for an unknown id, 403 "Not your listing" for someone else's).

Deliberately a NEW router, not folded into `properties.py`: every endpoint
here is partner-authenticated and partner-scoped (unlike Prompt 2's
`/trust`, `/duplicate-check`, `/reports`, which are public/customer-facing
and are natural fits for `properties.router`'s existing `/{property_id}/...`
namespace) — so this gets its own `/partner/properties` prefix + tag,
mounted in `main.py` the same way `property_request_partner.router` already
is.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, get_mediator_user
from app.core.audit import record_audit
from app.core.trust_config import COMPLETENESS_FIELDS
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.user import User
from app.schemas.partner_quality import (
    ImageQualityOut,
    PartnerAvailabilityConfirmOut,
    PartnerImproveWithAiOut,
    PartnerImproveWithAiRequest,
    PartnerListingQualityOut,
)
from app.schemas.trust import CompletenessOut
from app.services import image_quality as image_quality_service
from app.services import listing_completeness as listing_completeness_service
from app.services import partner_listing_ai

router = APIRouter()

# Plain-language, partner-facing suggestion per missing-field key — keyed by
# the same field keys `COMPLETENESS_FIELDS` (trust_config.py) already
# defines, just phrased as an action rather than a label. Anything without a
# specific template here falls back to a generic "Add {label}." — see
# `_missing_field_suggestions`.
_SUGGESTION_TEMPLATES: dict[str, str] = {
    "title": "Add a clear, descriptive title.",
    "district": "Add the district/area so renters can find this listing in search.",
    "city": "Add the city.",
    "price": "Add a price — listings without a price are far less likely to be contacted.",
    "property_type": "Specify the property type (Apartment, Villa, etc.).",
    "bedrooms": "Add the number of bedrooms.",
    "bathrooms": "Add the number of bathrooms.",
    "size_sq_m": "Add the size in square meters.",
    "images": "Upload at least one photo — listings with photos get far more interest.",
    "description": "Add a description explaining what makes this property worth viewing.",
    "coordinates": "Set the map location so this listing shows up correctly on the map.",
    "furnished": "Specify the furnishing status (Furnished/Unfurnished/Semi-furnished).",
    "living_rooms": "Add the number of living rooms.",
    "contact_phone": "Add a contact number so interested renters can reach you.",
    "multiple_images": "Add at least 3 photos for a stronger listing.",
    "property_age": "Add the property's age.",
    "deed_area": "Add the deed area.",
    "whatsapp": "Add a WhatsApp number.",
    "license_number": "Add your license number.",
}

# CompletenessResult only carries display labels (see listing_completeness.py),
# not field keys, so build a label -> key lookup once from the same
# COMPLETENESS_FIELDS config Prompt 1 already defined, rather than
# duplicating field metadata here.
_LABEL_TO_KEY: dict[str, str] = {
    label: key for fields in COMPLETENESS_FIELDS.values() for key, label, _check in fields
}


def _missing_field_suggestions(completeness) -> list[str]:
    """Deterministic — no LLM. Missing *required* fields first (they carry
    the most completeness weight), then the rest, each mapped through
    `_SUGGESTION_TEMPLATES`."""
    ordered_labels = list(completeness.missing_required) + [
        label for label in completeness.missing_fields if label not in completeness.missing_required
    ]
    suggestions: list[str] = []
    for label in ordered_labels:
        key = _LABEL_TO_KEY.get(label)
        template = _SUGGESTION_TEMPLATES.get(key) if key else None
        suggestions.append(template or f"Add {label}.")
    return suggestions


def _load_owned_property(db: Session, property_id: int, mediator: Mediator) -> Property:
    prop = db.scalars(
        select(Property).where(Property.id == property_id).options(selectinload(Property.listing_images))
    ).first()
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    if prop.mediator_id != mediator.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your listing")
    return prop


@router.get("/{property_id}/quality", response_model=PartnerListingQualityOut)
def get_partner_listing_quality(
    property_id: int,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    """Listing completeness % + missing-field suggestions, reusing Prompt 1's
    `compute_listing_completeness` directly — the exact same function
    `assess_property_trust` calls for the customer Trust Center and (via the
    same service) the admin moderation view will call in Prompt 6, so all
    three surfaces are guaranteed to agree on a listing's completeness score
    by construction, not by convention."""
    _, mediator = mediator_user
    prop = _load_owned_property(db, property_id, mediator)

    completeness = listing_completeness_service.compute_listing_completeness(prop)
    img_quality = image_quality_service.assess_image_quality(prop)

    return PartnerListingQualityOut(
        property_id=prop.id,
        completeness=CompletenessOut(**vars(completeness)),
        missing_field_suggestions=_missing_field_suggestions(completeness),
        image_quality=ImageQualityOut.from_result(img_quality),
        availability_confirmed_at=prop.availability_confirmed_at,
    )


@router.post("/{property_id}/confirm-availability", response_model=PartnerAvailabilityConfirmOut)
def confirm_partner_property_availability(
    property_id: int,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    """Sets `availability_confirmed_at` to now — feeds Listing Freshness's
    "Recently Confirmed" category (Prompt 1's `listing_freshness.py`,
    already reading this column since Prompt 2 added it). No property status
    restriction: a mediator may confirm availability on a listing in any
    status, since this is purely a freshness signal, not a publish action."""
    user, mediator = mediator_user
    prop = _load_owned_property(db, property_id, mediator)

    prop.availability_confirmed_at = datetime.now(timezone.utc)
    record_audit(
        db,
        user_id=user.id,
        action="property.availability_confirmed",
        entity_type="property",
        entity_id=prop.id,
        metadata={"mediator_id": mediator.id},
    )
    db.commit()
    db.refresh(prop)
    return PartnerAvailabilityConfirmOut(property_id=prop.id, availability_confirmed_at=prop.availability_confirmed_at)


@router.post("/{property_id}/improve-with-ai", response_model=PartnerImproveWithAiOut)
def improve_partner_listing_with_ai(
    property_id: int,
    payload: PartnerImproveWithAiRequest,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    """AI wording assist over the mediator's own already-saved property
    facts only (see `partner_listing_ai._facts_block` — never a free-text
    draft the partner types into this request, so grounding can't drift from
    what's actually on the property row). Returns a suggestion only; the
    partner must call `PATCH /properties/partner/{id}` themselves to apply
    it — this endpoint never writes to the property."""
    user, mediator = mediator_user
    prop = _load_owned_property(db, property_id, mediator)

    suggested_title, suggested_description, generated_by = partner_listing_ai.improve_listing_wording(
        prop, focus=payload.focus, language=payload.language, user_id=user.id
    )
    return PartnerImproveWithAiOut(
        property_id=prop.id,
        suggested_title=suggested_title,
        suggested_description=suggested_description,
        generated_by=generated_by,
    )
