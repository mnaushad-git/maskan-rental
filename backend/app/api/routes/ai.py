import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from anthropic import beta_tool
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_current_user, get_db, get_optional_current_user
from app.api.routes.contracts import _check_contract_access
from app.core.ai import gateway
from app.core.ai.prompts import ADMIN_ADVISOR, CONTRACT_ASSISTANT, CUSTOMER_ADVISOR, PromptDefinition
from app.core.config import settings
from app.core.rate_limit import _client_identifier, check_rate_limit, rate_limit_dependency
from app.models.contract import Contract
from app.models.lead import Lead
from app.models.property import Property
from app.models.area_intelligence import AreaIntelligence
from app.models.mediator import Mediator, MediatorArea
from app.models.user import User

logger = logging.getLogger("app.api.routes.ai")

router = APIRouter()


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


# ── AI Alert Plus: free-tier daily chat cap, premium unlimited ─────────────
# A simple per-day Redis counter (reuses the same fixed-window limiter as
# every other rate limit in this app), not a new AI feature. Separate from
# the abuse-prevention `rate_limit_dependency("ai_chat", ...)` below — that
# one guards against bursts for everyone; this one is the product-tier gate.

def _enforce_free_chat_cap(request: Request, user: User | None) -> None:
    if user is not None and user.is_premium_active:
        return
    identifier = f"user:{user.id}" if user is not None else _client_identifier(request)
    result = check_rate_limit(
        "ai_chat_free_daily", identifier, limit=settings.AI_CHAT_FREE_DAILY_LIMIT, window_seconds=24 * 60 * 60
    )
    if not result.allowed:
        raise HTTPException(
            status_code=403,
            detail="You've reached today's free AI Advisor chat limit. Upgrade to myHome Premium for unlimited chats.",
        )


def _run_chat(feature: str, prompt: PromptDefinition, tools: list, req: ChatRequest, user_id: int | None = None) -> ChatResponse:
    messages = [{"role": m.role, "content": m.content} for m in req.history]
    messages.append({"role": "user", "content": req.message})

    status = "error"
    result = None
    try:
        result = gateway.run_chat(model=gateway.DEFAULT_MODEL, system=prompt.template, tools=tools, messages=messages)
        status = "ok"
        return ChatResponse(reply=result.reply)
    finally:
        gateway.log_ai_call(
            feature=feature,
            model=gateway.DEFAULT_MODEL,
            prompt=prompt,
            latency_ms=result.latency_ms if result else 0.0,
            status=status,
            user_id=user_id,
            input_tokens=result.input_tokens if result else None,
            output_tokens=result.output_tokens if result else None,
        )


def _stream_chat(feature: str, prompt: PromptDefinition, tools: list, req: ChatRequest, user_id: int | None = None) -> StreamingResponse:
    import time

    client = gateway.get_client()
    messages = [{"role": m.role, "content": m.content} for m in req.history]
    messages.append({"role": "user", "content": req.message})

    def events():
        started = time.monotonic()
        status = "error"
        try:
            runner = client.beta.messages.tool_runner(
                model=gateway.DEFAULT_MODEL,
                max_tokens=1500,
                system=prompt.template,
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
            status = "ok"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        finally:
            # Token usage isn't reliably extractable mid-stream from the tool
            # runner, so the streaming path logs latency/status only — the
            # non-streaming path (_run_chat) is the one with full token/cost data.
            gateway.log_ai_call(
                feature=feature,
                model=gateway.DEFAULT_MODEL,
                prompt=prompt,
                latency_ms=(time.monotonic() - started) * 1000,
                status=status,
                user_id=user_id,
            )

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
    admin: User = Depends(get_admin_user),
):
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured")
    try:
        return _run_chat("admin_chat", ADMIN_ADVISOR, _admin_tools(db), req, user_id=admin.id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI error: {exc}") from exc


@router.post(
    "/chat",
    response_model=ChatResponse,
    dependencies=[Depends(rate_limit_dependency("ai_chat", limit=20, window_seconds=600))],
)
def ai_chat(
    req: ChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured — set ANTHROPIC_API_KEY")
    _enforce_free_chat_cap(request, current_user)
    try:
        return _run_chat("customer_chat", CUSTOMER_ADVISOR, _customer_tools(db), req, user_id=current_user.id if current_user else None)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI error: {exc}") from exc


@router.post(
    "/chat/stream",
    dependencies=[Depends(rate_limit_dependency("ai_chat", limit=20, window_seconds=600))],
)
def ai_chat_stream(
    req: ChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured — set ANTHROPIC_API_KEY")
    _enforce_free_chat_cap(request, current_user)
    return _stream_chat("customer_chat_stream", CUSTOMER_ADVISOR, _customer_tools(db), req, user_id=current_user.id if current_user else None)


# ── AI Contract Assistant ───────────────────────────────────────────────────

class ContractFlagRequest(BaseModel):
    contract_id: int


class ContractFlag(BaseModel):
    category: str
    severity: str
    message: str


class ContractFlagsResponse(BaseModel):
    flags: list[ContractFlag]
    district_avg_monthly_rent: float | None = None
    generated_by: str  # "ai" | "fallback"


_VALID_SEVERITIES = {"info", "warning", "high"}


def _contract_district(contract: Contract) -> tuple[str | None, str | None]:
    if contract.property is not None:
        return contract.property.area, contract.property.city
    if contract.lead is not None:
        return contract.lead.area_name, contract.lead.city
    return None, None


def _district_avg_monthly_rent(db: Session, area: str | None, city: str | None) -> float | None:
    if not area and not city:
        return None
    stmt = select(func.avg(Property.monthly_rent)).where(
        Property.status == "Published", Property.listing_type == "rent"
    )
    if area:
        stmt = stmt.where(Property.area.ilike(f"%{area}%"))
    if city:
        stmt = stmt.where(Property.city.ilike(f"%{city}%"))
    avg = db.scalar(stmt)
    return round(avg, 2) if avg is not None else None


def _duration_months(contract: Contract) -> float:
    return round((contract.end_date - contract.start_date).days / 30.44, 1)


def _deterministic_flags(contract: Contract, avg_rent: float | None) -> list[ContractFlag]:
    """Rule-based fallback used when the AI call fails, and to top up the AI's
    output if it returns fewer than 3 flags — the acceptance bar (>=3 flag
    categories) must hold even if the model call degrades."""
    flags: list[ContractFlag] = []
    months = _duration_months(contract)

    if not contract.deposit_amount:
        flags.append(ContractFlag(category="deposit", severity="warning", message="No deposit amount is set on this contract — confirm the deposit with the landlord before signing."))
    elif contract.deposit_amount > contract.rent_amount * 2:
        flags.append(ContractFlag(category="deposit", severity="high", message=f"The deposit (SAR {contract.deposit_amount:,.0f}) is more than double the monthly rent — well above the typical one-to-two-month norm."))
    else:
        flags.append(ContractFlag(category="deposit", severity="info", message=f"The deposit (SAR {contract.deposit_amount:,.0f}) is within the typical one-to-two-month range for Saudi rentals."))

    if months < 6:
        flags.append(ContractFlag(category="duration", severity="warning", message=f"This lease runs about {months} months — shorter than the typical 12-month Saudi rental term."))
    elif months > 24:
        flags.append(ContractFlag(category="duration", severity="warning", message=f"This lease runs about {months} months — longer than the typical 12-month Saudi rental term."))
    else:
        flags.append(ContractFlag(category="duration", severity="info", message=f"This lease runs about {months} months, in line with typical Saudi rental terms."))

    if avg_rent:
        diff_pct = round((contract.rent_amount - avg_rent) / avg_rent * 100)
        if diff_pct >= 15:
            flags.append(ContractFlag(category="rent_vs_market", severity="warning", message=f"This rent is about {diff_pct}% above the district average (SAR {avg_rent:,.0f}/mo) for published rentals."))
        elif diff_pct <= -15:
            flags.append(ContractFlag(category="rent_vs_market", severity="info", message=f"This rent is about {abs(diff_pct)}% below the district average (SAR {avg_rent:,.0f}/mo) — worth double-checking the listing is accurate."))

    flags.append(ContractFlag(category="clauses", severity="warning", message="This digital contract only records rent, deposit, and dates — maintenance responsibility and other clauses aren't captured yet. Confirm those terms in writing with the landlord before signing."))
    return flags


def _extract_flags_json(raw: str) -> list[dict]:
    match = re.search(r"\{.*\}", raw.strip(), re.DOTALL)
    if not match:
        raise ValueError("AI did not return a JSON object")
    data = json.loads(match.group(0))
    flags = data.get("flags")
    if not isinstance(flags, list):
        raise ValueError("AI response missing 'flags' list")
    return flags


def _sanitize_flags(raw_flags: list[dict]) -> list[ContractFlag]:
    clean: list[ContractFlag] = []
    for f in raw_flags:
        if not isinstance(f, dict):
            continue
        category = str(f.get("category", "other"))[:40]
        severity = f.get("severity") if f.get("severity") in _VALID_SEVERITIES else "info"
        message = str(f.get("message", "")).strip()[:400]
        if not message:
            continue
        clean.append(ContractFlag(category=category, severity=severity, message=message))
    return clean[:6]


@router.post(
    "/contract-flags",
    response_model=ContractFlagsResponse,
    dependencies=[Depends(rate_limit_dependency("ai_contract_flags", limit=20, window_seconds=600, by_user=True))],
)
def contract_flags(
    req: ContractFlagRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contract = db.get(Contract, req.contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found.")
    _check_contract_access(contract, current_user, db)

    area, city = _contract_district(contract)
    avg_rent = _district_avg_monthly_rent(db, area, city)
    months = _duration_months(contract)

    if not settings.ANTHROPIC_API_KEY:
        return ContractFlagsResponse(
            flags=_deterministic_flags(contract, avg_rent),
            district_avg_monthly_rent=avg_rent,
            generated_by="fallback",
        )

    facts = "\n".join([
        f"Monthly rent: SAR {contract.rent_amount:,.0f}",
        f"Deposit: SAR {contract.deposit_amount:,.0f}" if contract.deposit_amount else "Deposit: not set",
        f"Lease duration: about {months} months ({contract.start_date} to {contract.end_date})",
        f"District: {area or 'unknown'}, {city or 'unknown'}",
        f"District average monthly rent (published listings): SAR {avg_rent:,.0f}" if avg_rent else "District average monthly rent: no data available",
    ])

    status = "error"
    result = None
    try:
        result = gateway.run_chat(
            model=gateway.DEFAULT_MODEL,
            system=CONTRACT_ASSISTANT.template,
            tools=[],
            messages=[{"role": "user", "content": f"Review this contract:\n{facts}\n\nRespond with the JSON flags object only."}],
            max_tokens=700,
        )
        status = "ok"
        flags = _sanitize_flags(_extract_flags_json(result.reply))
        if len(flags) < 3:
            flags = _deterministic_flags(contract, avg_rent)
            generated_by = "fallback"
        else:
            generated_by = "ai"
        return ContractFlagsResponse(flags=flags, district_avg_monthly_rent=avg_rent, generated_by=generated_by)
    except Exception as exc:  # noqa: BLE001 — a flaky AI call must degrade to deterministic flags, never 500 on a pre-signing check
        logger.warning("contract_flags: AI call failed, using deterministic fallback: %s", exc)
        status = "error"
        return ContractFlagsResponse(
            flags=_deterministic_flags(contract, avg_rent),
            district_avg_monthly_rent=avg_rent,
            generated_by="fallback",
        )
    finally:
        gateway.log_ai_call(
            feature="contract_flags",
            model=gateway.DEFAULT_MODEL,
            prompt=CONTRACT_ASSISTANT,
            latency_ms=result.latency_ms if result else 0.0,
            status=status,
            user_id=current_user.id,
            input_tokens=result.input_tokens if result else None,
            output_tokens=result.output_tokens if result else None,
        )
