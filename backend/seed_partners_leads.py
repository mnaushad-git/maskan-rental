"""Demo seed: 2 verified mediators (with listings) + one assigned lead with chat,
so the mobile My Leads / Lead detail / Agent profile screens show live content."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db import SessionLocal
from app.models.user import User
from app.models.mediator import Mediator, MediatorArea
from app.models.property import Property
from app.models.lead import Lead, LeadAssignment, LeadMessage, LeadSuggestion

now = datetime.now(timezone.utc)
# Demo partners never log in; reuse an existing valid hash rather than hashing
# (avoids the passlib/bcrypt version incompatibility in this venv).
PLACEHOLDER_HASH = None  # filled from an existing user at runtime

PARTNERS = [
    {
        "email": "ahmed.partner@maskan.sa",
        "agency": "Yasmin Real Estate",
        "phone": "+966501112233",
        "license": "RE-1001",
        "bio": "Riyadh residential specialist covering the northern districts. 8 years matching families with the right home in Al Yasmin, Al Narjis and Al Malqa.",
        "image": "https://i.pravatar.cc/200?img=12",
        "areas": [("Al Yasmin", "Riyadh"), ("Al Narjis", "Riyadh"), ("Al Malqa", "Riyadh")],
        "deals": 34,
    },
    {
        "email": "sara.partner@maskan.sa",
        "agency": "Olaya Property Partners",
        "phone": "+966502223344",
        "license": "RE-1002",
        "bio": "Central Riyadh leasing expert. I help professionals and corporate tenants find well-priced apartments in Al Olaya and Al Rawdah.",
        "image": "https://i.pravatar.cc/200?img=32",
        "areas": [("Al Olaya", "Riyadh"), ("Al Rawdah", "Riyadh")],
        "deals": 21,
    },
]


def upsert_partner(db, p):
    user = db.scalars(select(User).where(User.email == p["email"])).first()
    if not user:
        user = User(email=p["email"], full_name=p["agency"], hashed_password=PLACEHOLDER_HASH)
        db.add(user)
        db.flush()
    med = db.scalars(select(Mediator).where(Mediator.user_id == user.id)).first()
    if not med:
        med = Mediator(user_id=user.id, license_number=p["license"], phone=p["phone"])
        db.add(med)
    med.agency_name = p["agency"]
    med.bio = p["bio"]
    med.profile_image_url = p["image"]
    med.is_verified = True
    med.approval_status = "approved"
    med.subscription_status = "active"
    med.subscription_expires_at = now + timedelta(days=365)
    med.total_leads_accepted = p["deals"]
    db.flush()
    # areas
    existing = {(a.area_name, a.city) for a in med.areas}
    for area_name, city in p["areas"]:
        if (area_name, city) not in existing:
            db.add(MediatorArea(mediator_id=med.id, area_name=area_name, city=city))
    return med


def main():
    global PLACEHOLDER_HASH
    db = SessionLocal()
    try:
        PLACEHOLDER_HASH = db.scalars(select(User.hashed_password).limit(1)).first() or "x"
        m1 = upsert_partner(db, PARTNERS[0])
        m2 = upsert_partner(db, PARTNERS[1])
        db.flush()

        # Assign Riyadh listings to the two partners so agent profiles show listings
        riyadh = db.scalars(
            select(Property).where(Property.city == "Riyadh", Property.status == "Published").limit(20)
        ).all()
        for i, prop in enumerate(riyadh):
            prop.mediator_id = m1.id if i % 2 == 0 else m2.id
        db.flush()

        # Lead for the app user (mnaushad@maskanai.com, id=2), assigned to m1 with chat
        app_user = db.scalars(select(User).where(User.email == "mnaushad@maskanai.com")).first()
        if app_user:
            existing_lead = db.scalars(
                select(Lead).where(Lead.customer_user_id == app_user.id, Lead.area_name == "Al Yasmin")
            ).first()
            if not existing_lead:
                lead = Lead(
                    customer_user_id=app_user.id,
                    customer_name=app_user.full_name or "Mohammad Naushad",
                    customer_phone="+966555555555",
                    customer_email=app_user.email,
                    area_name="Al Yasmin",
                    city="Riyadh",
                    min_budget=6000,
                    max_budget=9000,
                    bedrooms_needed=3,
                    requirements_note="Family villa, prefer close to schools and a park.",
                    status="in_progress",
                    source="mobile_app",
                )
                db.add(lead)
                db.flush()
                db.add(LeadAssignment(
                    lead_id=lead.id, mediator_id=m1.id, status="accepted",
                    accepted_at=now, expires_at=now + timedelta(days=7),
                ))
                db.add(LeadMessage(
                    lead_id=lead.id, sender_user_id=m1.user_id, sender_role="mediator",
                    content="Hi Mohammad! I'm Ahmed from Yasmin Real Estate. I have a few 3BR options in Al Yasmin within your budget — when are you looking to move in?",
                    is_read=True,
                ))
                db.add(LeadMessage(
                    lead_id=lead.id, sender_user_id=app_user.id, sender_role="customer",
                    content="Thanks Ahmed! Ideally within the next month. A garden would be a plus.",
                    is_read=True,
                ))
                # a couple of suggested properties in Al Yasmin / Riyadh
                for prop in riyadh[:3]:
                    db.add(LeadSuggestion(
                        lead_id=lead.id, property_id=prop.id, match_score=88.0,
                        reason="Matches area and budget",
                    ))
                print(f"  Lead #{lead.id} created for {app_user.email}, assigned to {m1.agency_name}")
            else:
                print(f"  Lead already exists (#{existing_lead.id})")

        db.commit()
        print(f"Partners: {m1.agency_name} (id={m1.id}), {m2.agency_name} (id={m2.id})")
        print(f"Assigned {len(riyadh)} Riyadh listings across the two partners.")
        print("Seed complete.")
    except Exception as exc:
        db.rollback()
        print(f"Seed failed: {exc}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
