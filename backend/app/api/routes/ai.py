import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from anthropic import Anthropic, beta_tool
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.core.config import settings
from app.core.rate_limit import rate_limit_dependency
from app.models.lead import Lead
from app.models.property import Property
from app.models.area_intelligence import AreaIntelligence
from app.models.mediator import Mediator, MediatorArea
from app.models.user import User

router = APIRouter()

_PERSONA = (
    "You are Maskan AI, the built-in rental advisor for the Maskan platform — "
    "a Saudi rental marketplace. "
    "You have tools to look up live platform data (listings, district scores, mediators, rent averages). "
    "ALWAYS call a tool to check real data before answering a question about listings, prices, areas, or "
    "mediators — never invent them. If a tool returns no results, say so and suggest what to try instead. "
    "Quote monthly and annual rents in SAR. Be concise and practical.\n\n"
    "IMPORTANT — Clickable links in your responses:\n"
    "- When you mention a specific property by name, always format it as a markdown link: "
    "[Property Title](/property/{id}) where {id} is the numeric ID shown in brackets in tool results, e.g. [42].\n"
    "- When you mention a district or area (e.g. Al Yasmin, Al Malqa), format it as: "
    "[Area Name](/areas?area=Area+Name) — replace spaces with + in the URL.\n"
    "- When you mention a city (e.g. Riyadh, Jeddah), format it as: "
    "[City Name](/search?city=City+Name).\n"
    "- When you mention a mediator, format it as a search link: "
    "[Mediator Name or License](/search?city=City+Name).\n"
    "Always use these link formats so customers can navigate directly to relevant pages."
)


# ── Customer-facing tools ──────────────────────────────────────────────────────
# Each tool queries only what's needed for the question at hand, instead of the
# old approach of dumping every listing/area/mediator into the prompt on every turn.

def _customer_tools(db: Session) -> list:
    @beta_tool
    def search_listings(
        city: str | None = None,
        area: str | None = None,
        listing_type: str | None = None,
        max_monthly_rent: float | None = None,
        min_bedrooms: int | None = None,
    ) -> str:
        """Search published property listings on the Maskan platform.

        Args:
            city: Filter by city, e.g. Riyadh, Jeddah.
            area: Filter by district/area name, e.g. Al Yasmin.
            listing_type: "rent" or "sale".
            max_monthly_rent: Maximum monthly rent in SAR (rent listings only).
            min_bedrooms: Minimum number of bedrooms.
        """
        stmt = select(Property).where(Property.status == "Published")
        if city:
            stmt = stmt.where(Property.city.ilike(f"%{city}%"))
        if area:
            stmt = stmt.where(Property.area.ilike(f"%{area}%"))
        if listing_type:
            stmt = stmt.where(Property.listing_type == listing_type)
        if min_bedrooms is not None:
            stmt = stmt.where(Property.bedrooms >= min_bedrooms)
        if max_monthly_rent is not None:
            stmt = stmt.where(Property.monthly_rent <= max_monthly_rent)
        stmt = stmt.order_by(Property.monthly_rent).limit(20)
        props = db.scalars(stmt).all()
        if not props:
            return "No matching published listings found."
        lines = []
        for p in props:
            beds = f"{p.bedrooms}BR" if p.bedrooms else "?"
            baths = f"{p.bathrooms}BA" if p.bathrooms else "?"
            size = f"{p.size_sq_m}m²" if p.size_sq_m else "size n/a"
            if p.listing_type == "sale" and p.sale_price:
                price = f"SAR {int(p.sale_price):,} (sale)"
            elif p.monthly_rent:
                price = f"SAR {int(p.monthly_rent):,}/mo (SAR {round(p.monthly_rent * 12):,}/yr)"
            else:
                price = "price n/a"
            lines.append(f"[{p.id}] {p.title} | {p.area}, {p.city} | {beds}/{baths} | {size} | {price}")
        return "\n".join(lines)

    @beta_tool
    def get_area_score(district: str) -> str:
        """Get Maskan's platform intelligence score and overview for one district/area.

        Args:
            district: The district/area name, e.g. Al Yasmin, Al Malqa.
        """
        row = db.scalars(
            select(AreaIntelligence).where(AreaIntelligence.area_name.ilike(f"%{district}%"))
        ).first()
        if not row:
            return f"No intelligence data found for '{district}'."

        def fmt(v):
            return f"{round(v)}" if v is not None else "n/a"

        tags = ", ".join(row.tags) if row.tags else "none"
        lines = [
            f"{row.area_name}, {row.city} — Area score: {fmt(row.area_score)}, "
            f"School: {fmt(row.school_score)}, Healthcare: {fmt(row.healthcare_score)}, "
            f"Traffic: {fmt(row.traffic_score)}, Family: {fmt(row.family_score)}. Tags: {tags}."
        ]
        if row.overview:
            lines.append(f"Overview: {row.overview}")
        if row.lifestyle:
            amenities = ", ".join(
                f"{cat}: {info.get('count', 0)}" for cat, info in row.lifestyle.items() if info.get("count")
            )
            if amenities:
                lines.append(f"Nearby amenities — {amenities}.")
        return "\n".join(lines)

    @beta_tool
    def top_areas_by_amenity(category: str, city: str | None = None, limit: int = 10) -> str:
        """Find districts with the highest count of a nearby amenity category, from live place data.

        Args:
            category: One of: mosques, restaurants, gyms, malls, parks.
            city: Filter by city, e.g. Riyadh.
            limit: Max districts to return (default 10).
        """
        valid = {"mosques", "restaurants", "gyms", "malls", "parks"}
        if category not in valid:
            return f"Unknown category '{category}'. Valid categories: {', '.join(sorted(valid))}."
        stmt = select(AreaIntelligence)
        if city:
            stmt = stmt.where(AreaIntelligence.city.ilike(f"%{city}%"))
        rows = db.scalars(stmt).all()
        scored = [(r, (r.lifestyle or {}).get(category, {}).get("count", 0)) for r in rows]
        scored = [pair for pair in scored if pair[1]]
        if not scored:
            return f"No {category} data found for that city."
        scored.sort(key=lambda pair: pair[1], reverse=True)
        return "\n".join(f"{r.area_name}, {r.city} — {cnt} {category} nearby" for r, cnt in scored[:limit])

    @beta_tool
    def top_areas(city: str | None = None, limit: int = 10) -> str:
        """List the top-scoring districts by platform area score, optionally filtered by city.

        Args:
            city: Filter by city, e.g. Riyadh.
            limit: Max number of districts to return (default 10).
        """
        stmt = select(AreaIntelligence).order_by(AreaIntelligence.area_score.desc().nulls_last()).limit(limit)
        if city:
            stmt = stmt.where(AreaIntelligence.city.ilike(f"%{city}%"))
        rows = db.scalars(stmt).all()
        if not rows:
            return "No district data found."

        def fmt(v):
            return f"{round(v)}" if v is not None else "n/a"

        return "\n".join(f"{r.area_name}, {r.city} — score {fmt(r.area_score)}" for r in rows)

    @beta_tool
    def find_mediators(area: str | None = None, city: str | None = None) -> str:
        """Find active, verified mediators (partners) covering a given area or city.

        Args:
            area: District/area name.
            city: City name.
        """
        stmt = (
            select(Mediator)
            .where(Mediator.subscription_status == "active", Mediator.is_verified.is_(True))
        )
        if area or city:
            stmt = stmt.join(MediatorArea, MediatorArea.mediator_id == Mediator.id)
            if area:
                stmt = stmt.where(MediatorArea.area_name.ilike(f"%{area}%"))
            if city:
                stmt = stmt.where(MediatorArea.city.ilike(f"%{city}%"))
        stmt = stmt.distinct().limit(15)
        rows = db.scalars(stmt).all()
        if not rows:
            return "No verified active mediators found for that area."
        lines = []
        for m in rows:
            agency = f" ({m.agency_name})" if m.agency_name else ""
            covered = ", ".join(a.area_name for a in m.areas) if m.areas else "All areas"
            lines.append(f"License {m.license_number}{agency} | Areas: {covered} | Phone: {m.phone}")
        return "\n".join(lines)

    @beta_tool
    def rent_summary(area: str | None = None, city: str | None = None) -> str:
        """Get average/min/max monthly rent and listing count for an area or city.

        Args:
            area: District/area name.
            city: City name.
        """
        stmt = (
            select(
                Property.area, Property.city,
                func.avg(Property.monthly_rent).label("avg_monthly"),
                func.min(Property.monthly_rent).label("min_monthly"),
                func.max(Property.monthly_rent).label("max_monthly"),
                func.count(Property.id).label("count"),
            )
            .where(Property.status == "Published", Property.listing_type == "rent")
            .group_by(Property.area, Property.city)
        )
        if area:
            stmt = stmt.where(Property.area.ilike(f"%{area}%"))
        if city:
            stmt = stmt.where(Property.city.ilike(f"%{city}%"))
        rows = db.execute(stmt).all()
        if not rows:
            return "No rent data found for that area/city."
        lines = []
        for r in rows:
            lines.append(
                f"{r.area}, {r.city} — avg SAR {round(r.avg_monthly):,}/mo, "
                f"range SAR {round(r.min_monthly):,}-{round(r.max_monthly):,}/mo, {r.count} listings"
            )
        return "\n".join(lines)

    return [search_listings, get_area_score, top_areas, top_areas_by_amenity, find_mediators, rent_summary]


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
    "You have tools to look up platform data on demand: listings (any status), leads, partners, and user "
    "counts. Call a tool whenever a question needs current data — never invent numbers.\n"
    "Your role is to help the admin:\n"
    "1. ANALYSE data — answer questions about leads, revenue, partner performance, listing health.\n"
    "2. GUIDE creation — when the admin asks to create a listing, partner, or lead, extract all the details "
    "they provide and return a JSON block at the end of your reply wrapped in <action> tags so the frontend "
    "can pre-fill the form. Format: <action>{\"type\":\"create_listing\"|\"create_partner\"|\"create_lead\", "
    "\"data\":{...fields...}}</action>\n"
    "3. HIGHLIGHT issues — flag listings with zero rent, leads stuck in pending_review, unverified "
    "partners, etc.\n"
    "Be concise, use bullet points for data summaries, and always quote numbers from tool results.\n"
    "NEVER invent data. If a tool returns nothing relevant, say so clearly."
)


def _admin_tools(db: Session) -> list:
    @beta_tool
    def query_properties(status: str | None = None, limit: int = 20) -> str:
        """List properties, optionally filtered by status, most recent first.

        Args:
            status: Listing status, e.g. "Published", "Pending Approval", "Rejected". Omit for all statuses.
            limit: Max rows to return (default 20).
        """
        stmt = select(Property).order_by(Property.id.desc()).limit(limit)
        if status:
            stmt = stmt.where(Property.status == status)
        props = db.scalars(stmt).all()
        if not props:
            return "No properties found."
        lines = []
        for p in props:
            rent = f"SAR {round(p.monthly_rent):,}/mo" if p.monthly_rent else "no rent set"
            lines.append(f"[{p.id}] {p.title} | {p.status} | {p.area}, {p.city} | {rent} | owner: {p.owner_name}")
        return "\n".join(lines)

    @beta_tool
    def query_leads(status: str | None = None, limit: int = 20) -> str:
        """List leads, optionally filtered by status, most recent first.

        Args:
            status: Lead status, e.g. "pending_review", "active", "closed". Omit for all statuses.
            limit: Max rows to return (default 20).
        """
        stmt = select(Lead).order_by(Lead.created_at.desc()).limit(limit)
        if status:
            stmt = stmt.where(Lead.status == status)
        leads = db.scalars(stmt).all()
        if not leads:
            return "No leads found."
        return "\n".join(
            f"[{l.id}] {l.customer_name} | {l.status} | {l.area_name}, {l.city} | {l.customer_phone}"
            for l in leads
        )

    @beta_tool
    def query_partners(limit: int = 20) -> str:
        """List partners (mediators) ranked by leads accepted, with verification and subscription status.

        Args:
            limit: Max rows to return (default 20).
        """
        stmt = select(Mediator).order_by(Mediator.total_leads_accepted.desc()).limit(limit)
        partners = db.scalars(stmt).all()
        if not partners:
            return "No partners found."
        lines = []
        for m in partners:
            verified = "verified" if m.is_verified else "unverified"
            areas = ", ".join(a.area_name for a in m.areas) if m.areas else "no areas"
            lines.append(
                f"[{m.id}] {m.agency_name or 'N/A'} | {m.phone} | {verified} | "
                f"sub: {m.subscription_status} | leads: {m.total_leads_accepted} | areas: {areas}"
            )
        return "\n".join(lines)

    @beta_tool
    def platform_counts() -> str:
        """Get platform-wide counts: users, listings by status, leads by status."""
        user_count = db.scalar(select(func.count(User.id))) or 0
        prop_rows = db.execute(select(Property.status, func.count(Property.id)).group_by(Property.status)).all()
        lead_rows = db.execute(select(Lead.status, func.count(Lead.id)).group_by(Lead.status)).all()
        lines = [f"Users: {user_count}", "Listings by status:"]
        lines += [f"  {status}: {count}" for status, count in prop_rows]
        lines.append("Leads by status:")
        lines += [f"  {status}: {count}" for status, count in lead_rows]
        return "\n".join(lines)

    @beta_tool
    def rent_summary(area: str | None = None, city: str | None = None) -> str:
        """Get average monthly rent and listing count for published rentals, by area or city.

        Args:
            area: District/area name.
            city: City name.
        """
        stmt = (
            select(
                Property.area, Property.city,
                func.avg(Property.monthly_rent).label("avg"),
                func.count(Property.id).label("cnt"),
            )
            .where(Property.status == "Published", Property.listing_type == "rent")
            .group_by(Property.area, Property.city)
        )
        if area:
            stmt = stmt.where(Property.area.ilike(f"%{area}%"))
        if city:
            stmt = stmt.where(Property.city.ilike(f"%{city}%"))
        rows = db.execute(stmt).all()
        if not rows:
            return "No rent data found for that area/city."
        return "\n".join(f"{r.area}, {r.city} — avg SAR {round(r.avg):,}/mo ({r.cnt} listings)" for r in rows)

    return [query_properties, query_leads, query_partners, platform_counts, rent_summary]


def _run_chat(system_prompt: str, tools: list, req: ChatRequest) -> ChatResponse:
    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    messages = [{"role": m.role, "content": m.content} for m in req.history]
    messages.append({"role": "user", "content": req.message})

    runner = client.beta.messages.tool_runner(
        model="claude-sonnet-4-6",
        max_tokens=1500,
        system=system_prompt,
        tools=tools,
        messages=messages,
    )
    final = None
    for message in runner:
        final = message
    if final is None:
        raise HTTPException(status_code=500, detail="AI error: no response generated")
    reply = "".join(block.text for block in final.content if block.type == "text")
    return ChatResponse(reply=reply)


def _stream_chat(system_prompt: str, tools: list, req: ChatRequest) -> StreamingResponse:
    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    messages = [{"role": m.role, "content": m.content} for m in req.history]
    messages.append({"role": "user", "content": req.message})

    def events():
        try:
            runner = client.beta.messages.tool_runner(
                model="claude-sonnet-4-6",
                max_tokens=1500,
                system=system_prompt,
                tools=tools,
                messages=messages,
                stream=True,
            )
            # Each iteration is one model turn (a tool call, or the final answer);
            # the runner executes tool calls and feeds results back in between —
            # we just forward whatever text each turn streams to the client.
            for turn in runner:
                for delta in turn.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'delta': delta})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/admin-chat",
    response_model=ChatResponse,
    dependencies=[Depends(rate_limit_dependency("ai_admin_chat", limit=30, window_seconds=600, by_user=True))],
)
def admin_ai_chat(
    req: ChatRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured")
    try:
        return _run_chat(_ADMIN_PERSONA, _admin_tools(db), req)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI error: {exc}") from exc


@router.post(
    "/chat",
    response_model=ChatResponse,
    dependencies=[Depends(rate_limit_dependency("ai_chat", limit=20, window_seconds=600))],
)
def ai_chat(req: ChatRequest, db: Session = Depends(get_db)):
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured — set ANTHROPIC_API_KEY")
    try:
        return _run_chat(_PERSONA, _customer_tools(db), req)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI error: {exc}") from exc


@router.post(
    "/chat/stream",
    dependencies=[Depends(rate_limit_dependency("ai_chat", limit=20, window_seconds=600))],
)
def ai_chat_stream(req: ChatRequest, db: Session = Depends(get_db)):
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured — set ANTHROPIC_API_KEY")
    return _stream_chat(_PERSONA, _customer_tools(db), req)
