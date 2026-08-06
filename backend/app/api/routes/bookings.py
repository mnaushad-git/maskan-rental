from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.models.booking import Booking
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.user import User
from app.schemas.booking import AvailabilityOut, BookingCreate, BookingOut

router = APIRouter()


def _overlap_filter(property_id: int, check_in: date, check_out: date):
    """Half-open range overlap ([) — a checkout day may equal another
    booking's check-in day. Mirrors the DB-level exclusion constraint's
    daterange semantics so the app-level pre-check and the DB guard agree."""
    return and_(
        Booking.property_id == property_id,
        Booking.status != "cancelled",
        Booking.check_in < check_out,
        Booking.check_out > check_in,
    )


def _is_available(db: Session, property_id: int, check_in: date, check_out: date) -> bool:
    conflict = db.query(Booking.id).filter(_overlap_filter(property_id, check_in, check_out)).first()
    return conflict is None


@router.get("/availability", response_model=AvailabilityOut)
def check_availability(
    property_id: int = Query(...),
    check_in: date = Query(...),
    check_out: date = Query(...),
    db: Session = Depends(get_db),
):
    if check_out <= check_in:
        raise HTTPException(status_code=400, detail="check_out must be after check_in.")
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found.")

    return AvailabilityOut(
        property_id=property_id,
        check_in=check_in,
        check_out=check_out,
        available=_is_available(db, property_id, check_in, check_out),
    )


@router.post("/", response_model=BookingOut, status_code=201)
def create_booking(
    body: BookingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prop = db.get(Property, body.property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found.")

    if not _is_available(db, body.property_id, body.check_in, body.check_out):
        raise HTTPException(status_code=409, detail="Property is not available for the requested dates.")

    booking = Booking(
        property_id=body.property_id,
        renter_user_id=current_user.id,
        check_in=body.check_in,
        check_out=body.check_out,
        total_price=body.total_price,
        status="confirmed",
    )
    db.add(booking)
    try:
        db.commit()
    except IntegrityError:
        # Belt-and-suspenders against a concurrent booking that slipped past
        # the pre-check above — the DB exclusion constraint is the real
        # source of truth for overlap prevention.
        db.rollback()
        raise HTTPException(status_code=409, detail="Property is not available for the requested dates.")
    db.refresh(booking)
    return booking


@router.get("/my", response_model=list[BookingOut])
def my_bookings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Booking)
        .filter(Booking.renter_user_id == current_user.id)
        .order_by(Booking.check_in.desc())
        .all()
    )


@router.get("/property/{property_id}", response_model=list[BookingOut])
def property_bookings(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found.")

    mediator = db.query(Mediator).filter(Mediator.user_id == current_user.id).first()
    is_owner = mediator is not None and mediator.id == prop.mediator_id
    is_admin = current_user.email in settings.admin_emails
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="Only the property's mediator or an admin can view its bookings.")

    return (
        db.query(Booking)
        .filter(Booking.property_id == property_id)
        .order_by(Booking.check_in.desc())
        .all()
    )


@router.post("/{booking_id}/cancel", response_model=BookingOut)
def cancel_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    booking = db.get(Booking, booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    if booking.renter_user_id != current_user.id and current_user.email not in settings.admin_emails:
        raise HTTPException(status_code=403, detail="Only the renter or an admin can cancel this booking.")
    if booking.status == "cancelled":
        raise HTTPException(status_code=400, detail="Booking is already cancelled.")

    booking.status = "cancelled"
    db.commit()
    db.refresh(booking)
    return booking
