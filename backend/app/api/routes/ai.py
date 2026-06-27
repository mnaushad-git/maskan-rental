from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from anthropic import Anthropic
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.core.config import settings
from app.models.lead import Lead
from app.models.property import Property
from app.models.area_intelligence import AreaIntelligence
from app.models.mediator import Mediator, MediatorArea
from app.models.user import User

router = APIRouter()

_PERSONA = (
    "You are Maskan AI, the built-in rental advisor for the Maskan platform — "
    "a Saudi rental marketplace. "
    "You ONLY answer using the real platform data provided below (properties, district scores, mediators). "
    "Never invent listings, prices, scores, or mediators that are not in the data. "
    "If the user asks about something not covered by the data, say so and suggest what IS available. "
    "Quote monthly and annual rents in SAR. Be concise and practical.\n\n"
    "IMPORTANT — Clickable links in your responses:\n"
    "- When you mention a specific property by name, always format it as a markdown link: "
    "[Property Title](/property/{id}) where {id} is the numeric ID shown in brackets in the data, e.g. [42].\n"
    "- When you mention a district or area (e.g. Al Yasmin, Al Malqa), format it as: "
    "[Area Name](/areas?area=Area+Name) — replace spaces with + in the URL.\n"
    "- When you mention a city (e.g. Riyadh, Jeddah), format it as: "
    "[City Name](/search?city=City+Name).\n"
    "- When you mention a mediator, format it as a search link: "
    "[Mediator Name or License](/search?city=City+Name).\n"
    "Always use these link formats so customers can navigate directly to relevant pages."
)


# ── Context builder ───────────────────────────────────────────────────────────

def _build_context(db: Session) -> str:
    lines: list[str] = ["=== MASKAN PLATFORM LIVE DATA ===\n"]

    # ── 1. Properties grouped by area ────────────────────────────────────────
    props = db.scalars(
        select(Property)
        .where(Property.status == "Published")
        .order_by(Property.area, Property.monthly_rent)
    ).all()

    lines.append(f"AVAILABLE LISTINGS ({len(props)} published)\n")
    by_area: dict[str, list[Property]] = {}
    for p in props:
        by_area.setdefault(f"{p.area}, {p.city}", []).append(p)

    for area_label, area_props in by_area.items():
        lines.append(f"\n{area_label} — {len(area_props)} listing(s):")
        for p in area_props:
            beds = f"{p.bedrooms}BR" if p.bedrooms else "?"
            baths = f"{p.bathrooms}BA" if p.bathrooms else "?"
            size = f"{p.size_sq_m}m²" if p.size_sq_m else "size n/a"
            monthly = round(p.monthly_rent / 12)
            lines.append(
                f"  • [{p.id}] {p.title} | {beds}/{baths} | {size} | "
                f"SAR {monthly:,}/mo (SAR {int(p.monthly_rent):,}/yr)"
            )

    # ── 2. District scores from platform intelligence ─────────────────────────
    intel_rows = db.scalars(
        select(AreaIntelligence).order_by(AreaIntelligence.area_score.desc().nulls_last())
    ).all()

    lines.append("\n\nDISTRICT SCORES (0–100, from Maskan platform intelligence)\n")
    lines.append(f"{'District':<22} {'City':<10} {'Area':>5} {'School':>7} {'Health':>7} {'Traffic':>8} {'Family':>7}  Tags")
    lines.append("-" * 80)
    for r in intel_rows:
        def fmt(v):
            return f"{round(v)}" if v is not None else "  -"
        tags = ", ".join(r.tags) if r.tags else ""
        lines.append(
            f"{r.area_name:<22} {r.city:<10} {fmt(r.area_score):>5} {fmt(r.school_score):>7} "
            f"{fmt(r.healthcare_score):>7} {fmt(r.traffic_score):>8} {fmt(r.family_score):>7}  {tags}"
        )
        if r.overview:
            lines.append(f"  Overview: {r.overview}")

    # ── 3. Verified mediators ─────────────────────────────────────────────────
    mediators = db.scalars(
        select(Mediator)
        .where(Mediator.subscription_status == "active")
        .order_by(Mediator.is_verified.desc())
    ).all()

    if mediators:
        lines.append("\n\nACTIVE MEDIATORS ON PLATFORM\n")
        for m in mediators:
            verified = "✓ Verified" if m.is_verified else "Pending"
            agency = f" ({m.agency_name})" if m.agency_name else ""
            area_names = ", ".join(a.area_name for a in m.areas) if m.areas else "All areas"
            lines.append(
                f"  • License {m.license_number}{agency} | {verified} | "
                f"Areas: {area_names} | Phone: {m.phone}"
            )
    else:
        lines.append("\n\nNo active mediators currently on platform.")

    # ── 4. Rent averages per area ─────────────────────────────────────────────
    avg_rows = db.execute(
        select(
            Property.area,
            Property.city,
            func.avg(Property.monthly_rent).label("avg_annual"),
            func.min(Property.monthly_rent).label("min_annual"),
            func.max(Property.monthly_rent).label("max_annual"),
            func.count(Property.id).label("count"),
        )
        .where(Property.status == "Published")
        .group_by(Property.area, Property.city)
        .order_by(func.avg(Property.monthly_rent).desc())
    ).all()

    lines.append("\n\nRENT SUMMARY BY DISTRICT\n")
    lines.append(f"{'District':<22} {'City':<10} {'Avg/mo':>8} {'Min/mo':>8} {'Max/mo':>8} {'Listings':>9}")
    lines.append("-" * 72)
    for row in avg_rows:
        avg_mo = round(row.avg_annual / 12)
        min_mo = round(row.min_annual / 12)
        max_mo = round(row.max_annual / 12)
        lines.append(
            f"{row.area:<22} {row.city:<10} "
            f"SAR {avg_mo:>6,} "
            f"SAR {min_mo:>6,} "
            f"SAR {max_mo:>6,} "
            f"{row.count:>9}"
        )

    return "\n".join(lines)


# ── Endpoint ──────────────────────────────────────────────────────────────────

class ConversationMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ConversationMessage] = []


class ChatResponse(BaseModel):
    reply: str


@router.get("/status")
def ai_status():
    key = settings.ANTHROPIC_API_KEY or ""
    return {"key_set": bool(key), "key_prefix": key[:12] if key else ""}


_ADMIN_PERSONA = (
    "You are Maskan Admin AI, the internal operations assistant for the Maskan rental platform. "
    "You have full visibility into platform data: all listings (every status), all leads, all partners, and user counts. "
    "Your role is to help the admin:\n"
    "1. ANALYSE data — answer questions about leads, revenue, partner performance, listing health.\n"
    "2. GUIDE creation — when the admin asks to create a listing, partner, or lead, extract all the details they provide "
    "and return a JSON block at the end of your reply wrapped in <action> tags so the frontend can pre-fill the form. "
    "Format: <action>{\"type\":\"create_listing\"|\"create_partner\"|\"create_lead\", \"data\":{...fields...}}</action>\n"
    "3. HIGHLIGHT issues — flag listings with zero rent, leads stuck in pending_review, unverified partners, etc.\n"
    "Be concise, use bullet points for data summaries, and always quote numbers from the data provided.\n"
    "NEVER invent data not present in the context. If the admin asks for something not in the data, say so clearly."
)


def _build_admin_context(db: Session) -> str:
    lines: list[str] = ["=== MASKAN ADMIN PLATFORM DATA ===\n"]

    # ── 1. Properties — all statuses ─────────────────────────────────────────
    props = db.scalars(select(Property).order_by(Property.status, Property.id.desc())).all()
    by_status: dict[str, list[Property]] = {}
    for p in props:
        by_status.setdefault(p.status, []).append(p)

    lines.append(f"PROPERTIES — {len(props)} total\n")
    for status, ps in by_status.items():
        lines.append(f"  {status}: {len(ps)}")
        for p in ps[:5]:
            rent = f"SAR {round(p.monthly_rent):,}/mo" if p.monthly_rent else "no rent set"
            lines.append(f"    [{p.id}] {p.title} | {p.area}, {p.city} | {rent} | owner: {p.owner_name}")
        if len(ps) > 5:
            lines.append(f"    … and {len(ps)-5} more")

    # ── 2. Leads ─────────────────────────────────────────────────────────────
    leads = db.scalars(select(Lead).order_by(Lead.created_at.desc())).all()
    by_lead_status: dict[str, list[Lead]] = {}
    for l in leads:
        by_lead_status.setdefault(l.status, []).append(l)

    lines.append(f"\nLEADS — {len(leads)} total\n")
    for status, ls in by_lead_status.items():
        lines.append(f"  {status}: {len(ls)}")
        for l in ls[:3]:
            lines.append(f"    [{l.id}] {l.customer_name} | {l.area_name}, {l.city} | {l.customer_phone}")
        if len(ls) > 3:
            lines.append(f"    … and {len(ls)-3} more")

    # ── 3. Partners ───────────────────────────────────────────────────────────
    partners = db.scalars(select(Mediator).order_by(Mediator.total_leads_accepted.desc())).all()
    lines.append(f"\nPARTNERS — {len(partners)} total\n")
    for m in partners:
        verified = "✓ verified" if m.is_verified else "unverified"
        areas = ", ".join(a.area_name for a in m.areas) if m.areas else "no areas"
        lines.append(
            f"  [{m.id}] {m.agency_name or 'N/A'} | {m.phone} | {verified} | "
            f"sub: {m.subscription_status} | leads: {m.total_leads_accepted} | areas: {areas}"
        )

    # ── 4. Users ──────────────────────────────────────────────────────────────
    user_count = db.scalar(select(func.count(User.id))) or 0
    lines.append(f"\nUSERS — {user_count} registered accounts")

    # ── 5. Rent averages ──────────────────────────────────────────────────────
    avg_rows = db.execute(
        select(
            Property.area, Property.city,
            func.avg(Property.monthly_rent).label("avg"),
            func.count(Property.id).label("cnt"),
        )
        .where(Property.status == "Published")
        .group_by(Property.area, Property.city)
        .order_by(func.avg(Property.monthly_rent).desc())
    ).all()
    lines.append("\nRENT AVERAGES (Published only)\n")
    for r in avg_rows:
        lines.append(f"  {r.area}, {r.city} — avg SAR {round(r.avg):,}/mo ({r.cnt} listings)")

    return "\n".join(lines)


@router.post("/admin-chat", response_model=ChatResponse)
def admin_ai_chat(
    req: ChatRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured")

    try:
        context = _build_admin_context(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Context error: {exc}") from exc

    system_prompt = f"{_ADMIN_PERSONA}\n\n{context}"

    try:
        client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        messages = [{"role": m.role, "content": m.content} for m in req.history]
        messages.append({"role": "user", "content": req.message})

        with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=1500,
            system=system_prompt,
            messages=messages,
        ) as stream:
            response = stream.get_final_message()

        reply = "".join(block.text for block in response.content if block.type == "text")
        return ChatResponse(reply=reply)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI error: {exc}") from exc


@router.post("/chat", response_model=ChatResponse)
def ai_chat(req: ChatRequest, db: Session = Depends(get_db)):
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured — set ANTHROPIC_API_KEY")

    try:
        platform_context = _build_context(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Context build error: {type(exc).__name__}: {exc}") from exc

    system_prompt = f"{_PERSONA}\n\n{platform_context}"

    try:
        client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        messages = [{"role": m.role, "content": m.content} for m in req.history]
        messages.append({"role": "user", "content": req.message})

        with client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system_prompt,
            messages=messages,
        ) as stream:
            response = stream.get_final_message()

        reply = "".join(block.text for block in response.content if block.type == "text")
        return ChatResponse(reply=reply)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI call error: {type(exc).__name__}: {exc}") from exc
