"""Who may read a property by direct id.

Search/list endpoints already return only Published listings; this rule
covers every *per-id* read (detail, images, similar, trust, intelligence,
duplicate-check, reports) so a Pending Approval / Rejected / Draft /
Suspended / Hidden listing — with its contact phone, licence number and
photos — cannot be fetched just by guessing its id.

  * Published                → anyone.
  * Any other status         → the owning partner and admins; plus a customer
                               who already has a viewing, offer or transaction
                               on this listing (so their workspace keeps
                               working if the partner re-submits an edit).
  * Hidden (admin moderation)→ the owning partner and admins only.

A listing the caller may not see returns 404 (not 403) so its existence is
not revealed.
"""

from fastapi import HTTPException, status
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.core.roles import is_admin_user
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_negotiation import PropertyNegotiation
from app.models.property_transaction import PropertyTransaction
from app.models.property_viewing import PropertyViewing
from app.models.user import User

PUBLIC_STATUS = "Published"
ADMIN_HIDDEN_STATUS = "Hidden"


def _is_owner(db: Session, prop: Property, user: User) -> bool:
    if prop.mediator_id is None:
        return False
    mediator_id = db.scalar(select(Mediator.id).where(Mediator.user_id == user.id))
    return mediator_id is not None and mediator_id == prop.mediator_id


def _customer_has_engagement(db: Session, prop: Property, user: User) -> bool:
    for model in (PropertyViewing, PropertyNegotiation, PropertyTransaction):
        if db.scalar(
            select(exists().where(model.property_id == prop.id, model.customer_user_id == user.id))
        ):
            return True
    return False


def can_view_property(db: Session, prop: Property, user: User | None) -> bool:
    if prop.status == PUBLIC_STATUS:
        return True
    if user is None:
        return False
    if is_admin_user(user) or _is_owner(db, prop, user):
        return True
    if prop.status == ADMIN_HIDDEN_STATUS:
        return False
    return _customer_has_engagement(db, prop, user)


def get_visible_property(db: Session, property_id: int, user: User | None) -> Property:
    prop = db.get(Property, property_id)
    if prop is None or not can_view_property(db, prop, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    return prop


def is_owner_or_admin(db: Session, prop: Property, user: User | None) -> bool:
    """Used to keep partner/admin activity out of customer view counts."""
    return user is not None and (is_admin_user(user) or _is_owner(db, prop, user))
