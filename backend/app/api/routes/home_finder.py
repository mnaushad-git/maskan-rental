"""AI Home Finder (Sections 2-14 of the feature brief): natural language →
structured criteria (`/interpret`), short-instruction criteria updates
(`/refine`), the deterministic ranked shortlist (`/search`), a per-property
AI explanation of the deterministic score (`/explain`), and recent-search
history for signed-in users (`/history`).

Interpretation/refinement/explanation go through the existing AI gateway
(`app.services.home_finder_ai`); the shortlist itself is always deterministic
(`app.services.home_finder_scoring`) — the AI never ranks or filters
properties directly (Section 3: "AI output must NEVER directly execute
arbitrary SQL or search parameters").
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.core.feature_flags import is_enabled
from app.core.rate_limit import rate_limit_dependency
from app.models.home_finder_search import HomeFinderSearch
from app.models.property import Property
from app.models.user import User
from app.schemas.home_finder import (
    EmptyResultInfo,
    HomeFinderCategories,
    HomeFinderExplainRequest,
    HomeFinderExplainResponse,
    HomeFinderInterpretRequest,
    HomeFinderInterpretResponse,
    HomeFinderRefineRequest,
    HomeFinderRefineResponse,
    HomeFinderResult,
    HomeFinderSearchHistoryItem,
    HomeFinderSearchRequest,
    HomeFinderSearchResponse,
)
from app.schemas.property import PropertyOut
from app.services import home_finder_ai, home_finder_scoring

router = APIRouter()


def _require_enabled() -> None:
    # Mirrors app/api/routes/property_requests.py's per-request flag check:
    # main.py's registration-time gate only takes effect on process restart,
    # so this is what lets the flag be toggled (and tested) at runtime too.
    if not is_enabled("ai_home_finder"):
        raise HTTPException(status_code=503, detail="AI Home Finder is not currently available")


@router.post(
    "/interpret",
    response_model=HomeFinderInterpretResponse,
    dependencies=[
        Depends(_require_enabled),
        Depends(rate_limit_dependency("ai_home_finder_interpret", limit=20, window_seconds=600)),
    ],
)
def interpret(
    req: HomeFinderInterpretRequest,
    current_user: User | None = Depends(get_optional_current_user),
):
    if not req.text.strip():
        raise HTTPException(status_code=422, detail="text must not be empty")
    criteria, ai_confidence, missing_fields, clarifying_questions, generated_by = home_finder_ai.interpret_query(
        text=req.text[:2000],
        locale=req.locale,
        transaction_type_hint=req.transaction_type_hint,
        user_id=current_user.id if current_user else None,
    )
    return HomeFinderInterpretResponse(
        criteria=criteria,
        ai_confidence=ai_confidence,
        missing_fields=missing_fields,
        clarifying_questions=clarifying_questions,
        generated_by=generated_by,
    )


@router.post(
    "/refine",
    response_model=HomeFinderRefineResponse,
    dependencies=[
        Depends(_require_enabled),
        Depends(rate_limit_dependency("ai_home_finder_refine", limit=20, window_seconds=600)),
    ],
)
def refine(
    req: HomeFinderRefineRequest,
    current_user: User | None = Depends(get_optional_current_user),
):
    if not req.instruction.strip():
        raise HTTPException(status_code=422, detail="instruction must not be empty")
    new_criteria, changes, generated_by = home_finder_ai.refine_criteria(
        criteria=req.criteria,
        instruction=req.instruction[:500],
        locale=req.locale,
        user_id=current_user.id if current_user else None,
    )
    return HomeFinderRefineResponse(criteria=new_criteria, changes=changes, generated_by=generated_by)


@router.post("/search", response_model=HomeFinderSearchResponse, dependencies=[Depends(_require_enabled)])
def search(
    req: HomeFinderSearchRequest,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    rank_result = home_finder_scoring.rank(db, req.criteria, top_n=req.limit)
    categories = home_finder_scoring.pick_categories(rank_result.top, req.criteria)

    results = [
        HomeFinderResult(
            property=PropertyOut.model_validate(sp.property, from_attributes=True),
            match_score=sp.match_score,
            dimension_scores=sp.dimension_scores,
            reasons=sp.reasons,
            trade_offs=sp.trade_offs,
        )
        for sp in rank_result.top
    ]

    empty_result = None
    if rank_result.exact_match_count == 0 and rank_result.pool_count > 0:
        message, restrictive_reasons, suggestions = home_finder_scoring.empty_result_suggestions(db, req.criteria, rank_result)
        empty_result = EmptyResultInfo(message=message, restrictive_reasons=restrictive_reasons, suggestions=suggestions)

    if current_user is not None:
        label = (req.query_text or "").strip()[:500] or _synthesize_label(req.criteria)
        db.add(
            HomeFinderSearch(
                user_id=current_user.id,
                query_text=label,
                criteria=req.criteria.model_dump(),
                result_count=len(results),
            )
        )
        db.commit()

    return HomeFinderSearchResponse(
        results=results,
        categories=HomeFinderCategories(**categories.__dict__),
        exact_match_count=rank_result.exact_match_count,
        pool_count=rank_result.pool_count,
        empty_result=empty_result,
    )


@router.post(
    "/explain",
    response_model=HomeFinderExplainResponse,
    dependencies=[
        Depends(_require_enabled),
        Depends(rate_limit_dependency("ai_home_finder_explain", limit=30, window_seconds=600)),
    ],
)
def explain(
    req: HomeFinderExplainRequest,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    prop = db.get(Property, req.property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    area_intel = home_finder_scoring.load_area_intel(db, [prop])
    scored = home_finder_scoring.score_property(req.criteria, prop, area_intel)
    summary, generated_by = home_finder_ai.explain_match(
        criteria=req.criteria,
        match_score=scored.match_score,
        reasons=scored.reasons,
        trade_offs=scored.trade_offs,
        user_id=current_user.id if current_user else None,
    )
    return HomeFinderExplainResponse(
        summary=summary,
        match_score=scored.match_score,
        reasons=scored.reasons,
        trade_offs=scored.trade_offs,
        generated_by=generated_by,
    )


@router.get("/history", response_model=list[HomeFinderSearchHistoryItem], dependencies=[Depends(_require_enabled)])
def history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.scalars(
        select(HomeFinderSearch)
        .where(HomeFinderSearch.user_id == current_user.id)
        .order_by(HomeFinderSearch.created_at.desc())
        .limit(10)
    ).all()
    return list(rows)


def _synthesize_label(criteria) -> str:
    parts = []
    if criteria.bedrooms:
        parts.append(f"{criteria.bedrooms}-bedroom")
    parts.append(criteria.property_type or "property")
    if criteria.transaction_type:
        parts.append("to buy" if criteria.transaction_type == "sale" else "to rent")
    if criteria.districts:
        parts.append(f"in {criteria.districts[0]}")
    elif criteria.city:
        parts.append(f"in {criteria.city}")
    return " ".join(parts)[:500] or "AI Home Finder search"
