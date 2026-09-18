"""
E2E test fixtures for the 18-prompt myMakan validation plan
(docs/testing/mymakan-e2e-test-prompts.md, Prompt 1).

Creates the fixed cast of accounts and properties every later prompt reuses:
Customer A, Customer B, Mediator A, Mediator B, plus one complete RENT
listing, one incomplete RENT listing, and one complete BUY/sale listing
(all owned by Mediator A, all with real comparables in the existing Riyadh
seed inventory).

All fixture rows are prefixed "E2E-" (external_id / title) or use the
"@mymakantest.local" email domain so they're never confused with real data
and are trivially greppable/removable. Safe to re-run — upserts by
email/external_id, exactly like backend/seed.py.

Run from backend/ directory:
    venv/Scripts/python.exe create_e2e_fixtures.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from passlib.context import CryptContext
from sqlalchemy import select

from app.db.session import SessionLocal
import app.models  # noqa: F401 — registers all models so relationship strings resolve
from app.models.user import User
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.listing_image import ListingImage
from app.core.geo import coords_for

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
FIXTURE_PASSWORD = "E2eTest@123"

_IMG = [
    "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1554995207-c18c203602cb?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=900&q=80",
]


def upsert_user(db, email: str, full_name: str, phone: str, is_admin: bool = False) -> User:
    # Login (auth.py's LoginRequest._validate_email) lowercases the email
    # before querying, and signup does the same before storing — normalize
    # here too so these fixtures can actually log in.
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user:
        print(f"  User already exists: {email} (id={user.id})")
        return user
    user = User(
        email=email,
        full_name=full_name,
        phone=phone,
        hashed_password=pwd_context.hash(FIXTURE_PASSWORD),
        is_active=True,
        is_admin=is_admin,
    )
    db.add(user)
    db.flush()
    print(f"  User created: {email} / {FIXTURE_PASSWORD} (id={user.id})")
    return user


def upsert_mediator(db, user: User, agency_name: str, phone: str, license_number: str) -> Mediator:
    mediator = db.scalar(select(Mediator).where(Mediator.user_id == user.id))
    if mediator:
        print(f"  Mediator already exists: {agency_name} (id={mediator.id})")
        return mediator
    mediator = Mediator(
        user_id=user.id,
        license_number=license_number,
        agency_name=agency_name,
        phone=phone,
        bio=f"E2E test fixture mediator — {agency_name}. Not a real agency.",
        approval_status="approved",
        is_verified=True,
        # Without this, `Mediator.subscription_status` defaults to "inactive"
        # (see app/models/mediator.py) and `get_mediator_user` (the auth
        # dependency gating essentially every partner/mediator-authenticated
        # endpoint — leads accept/available, partner_negotiations.py,
        # partner_viewings.py, partner_transactions.py, etc.) rejects every
        # request with a 403 regardless of approval_status/is_verified.
        # Found in Prompt 5 while testing the leads marketplace as Mediator
        # A/B — see the P5 ledger entry.
        subscription_status="active",
    )
    db.add(mediator)
    db.flush()
    print(f"  Mediator created: {agency_name} (id={mediator.id}, user_id={user.id})")
    return mediator


def upsert_property(db, external_id: str, **fields) -> Property:
    prop = db.scalar(select(Property).where(Property.external_id == external_id))
    if prop:
        for k, v in fields.items():
            setattr(prop, k, v)
        db.flush()
        print(f"  Property updated: {external_id} (id={prop.id})")
        return prop
    prop = Property(external_id=external_id, **fields)
    db.add(prop)
    db.flush()
    if prop.latitude is None or prop.longitude is None:
        prop.latitude, prop.longitude = coords_for(prop.area, prop.city, prop.id)
        db.flush()
    print(f"  Property created: {external_id} (id={prop.id}) — {fields.get('title')}")
    return prop


def set_images(db, prop: Property, urls: list[str]):
    existing = db.scalars(select(ListingImage).where(ListingImage.property_id == prop.id)).all()
    if len(existing) >= len(urls):
        return
    for img in existing:
        db.delete(img)
    db.flush()
    for i, url in enumerate(urls):
        db.add(ListingImage(property_id=prop.id, url=url, display_order=i))
    db.flush()


def main():
    db = SessionLocal()
    try:
        print("Customers")
        upsert_user(db, "e2e.customerA@mymakantest.local", "E2E Customer A", "+966500000001")
        upsert_user(db, "e2e.customerB@mymakantest.local", "E2E Customer B", "+966500000002")

        print("Mediators")
        med_a_user = upsert_user(db, "e2e.mediatorA@mymakantest.local", "E2E Mediator A", "+966500000003")
        med_b_user = upsert_user(db, "e2e.mediatorB@mymakantest.local", "E2E Mediator B", "+966500000004")
        mediator_a = upsert_mediator(db, med_a_user, "E2E Test Agency A", "+966500000003", "E2E-LIC-A-001")
        mediator_b = upsert_mediator(db, med_b_user, "E2E Test Agency B", "+966500000004", "E2E-LIC-B-001")
        db.commit()

        print("Properties — complete RENT listing (Mediator A)")
        complete_rent = upsert_property(
            db,
            external_id="E2E-RENT-COMPLETE-001",
            title="E2E Complete Rent — Al Yasmin 3BR Apartment",
            area="Al Yasmin",
            city="Riyadh",
            size_sq_m=210,
            listing_type="rent",
            monthly_rent=8500,  # realistic vs. comparable seed listings (id 2: SAR 8,200/mo, same area/bedrooms)
            bedrooms=3,
            bathrooms=3,
            owner_name="E2E Fixture Owner",
            status="Published",
            description=(
                "E2E test fixture — a deliberately COMPLETE rent listing with every "
                "Trust Center completeness field populated (images, coordinates, "
                "furnishing, contact numbers, license, deed area). Used to validate "
                "Property Intelligence / Trust Center scoring against a known-good "
                "listing. Not a real property."
            ),
            image_url=_IMG[0],
            property_type="Apartment",
            furnished="Furnished",
            mediator_id=mediator_a.id,
            living_rooms=2,
            property_age_years=3,
            commission_percent=2.5,
            has_kitchen=True,
            has_water=True,
            has_electricity=True,
            license_number="E2E-LIC-A-001",
            deed_area=210,
            contact_phone="+966500000003",
            whatsapp_phone="+966500000003",
        )
        set_images(db, complete_rent, _IMG)

        print("Properties — incomplete RENT listing (Mediator A)")
        upsert_property(
            db,
            external_id="E2E-RENT-INCOMPLETE-001",
            title="E2E Incomplete Rent — Al Narjis Apartment",
            area="Al Narjis",
            city="Riyadh",
            size_sq_m=None,
            listing_type="rent",
            monthly_rent=6000,
            bedrooms=None,
            bathrooms=None,
            owner_name=None,
            status="Published",
            description=None,
            image_url=None,
            property_type=None,
            furnished=None,
            mediator_id=mediator_a.id,
            contact_phone=None,
            whatsapp_phone=None,
        )

        print("Properties — complete BUY/sale listing (Mediator A)")
        complete_sale = upsert_property(
            db,
            external_id="E2E-SALE-COMPLETE-001",
            title="E2E Complete Sale — Al Yasmin 4BR Villa",
            area="Al Yasmin",
            city="Riyadh",
            size_sq_m=400,
            listing_type="sale",
            sale_price=2200000,
            bedrooms=4,
            bathrooms=5,
            owner_name="E2E Fixture Owner",
            status="Published",
            description=(
                "E2E test fixture — a deliberately COMPLETE sale/BUY listing with "
                "every Trust Center completeness field populated. Has real "
                "comparables among the existing Riyadh sale-listing seed inventory "
                "(same city + listing_type). Not a real property."
            ),
            image_url=_IMG[1],
            property_type="Villa",
            furnished=None,
            mediator_id=mediator_a.id,
            living_rooms=3,
            property_age_years=2,
            commission_percent=2.5,
            has_kitchen=True,
            has_water=True,
            has_electricity=True,
            license_number="E2E-LIC-A-001",
            deed_area=400,
            contact_phone="+966500000003",
            whatsapp_phone="+966500000003",
        )
        set_images(db, complete_sale, _IMG)

        db.commit()
        print("\nFixtures complete.")
        print(f"  Complete RENT listing id:   {complete_rent.id} (external_id=E2E-RENT-COMPLETE-001)")
        print(f"  Complete SALE listing id:   {complete_sale.id} (external_id=E2E-SALE-COMPLETE-001)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
