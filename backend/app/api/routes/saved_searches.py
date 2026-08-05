from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.audit import record_audit
from app.core.config import settings
from app.core.feature_flags import is_enabled
from app.core.idempotency import IdempotencyConflict, IdempotencyStore
from app.core.metrics import saved_searches_created_total
from app.core.outbox import EventType, record_event
from app.core.rate_limit import rate_limit_dependency
from app.core.search.filters import PropertyFilterCriteria
from app.models.saved_search import SavedSearch
from app.models.saved_search_match import SavedSearchMatch
from app.models.user import User as UserModel
from app.schemas.saved_search import (
    PropertyFilterCriteriaIn,
    SavedSearchCreate,
    SavedSearchDuplicateCandidate,
    SavedSearchMatchOut,
    SavedSearchOut,
    SavedSearchPreviewResponse,
    SavedSearchUpdate,
)
from app.services.saved_search_matcher import preview_match_count

router = APIRouter()


def _feature_gate() -> None:
    if not is_enabled("saved_search_alerts"):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Saved search alerts are not currently available")


def _to_criteria(filters_in: PropertyFilterCriteriaIn) -> PropertyFilterCriteria:
    return PropertyFilterCriteria(**filters_in.model_dump())


def _find_duplicate(db: Session, user_id: int, criteria: PropertyFilterCriteria) -> SavedSearch | None:
    fingerprint = criteria.fingerprint()
    candidates = db.scalars(
        select(SavedSearch).where(SavedSearch.user_id == user_id, SavedSearch.status == "active")
    ).all()
    for c in candidates:
        if PropertyFilterCriteria.from_dict(c.filters).fingerprint() == fingerprint:
            return c
    return None


def _attach_match_counts(db: Session, rows: list[SavedSearch]) -> list[SavedSearchOut]:
    if not rows:
        return []
    ids = [r.id for r in rows]
    counts = dict(
        db.execute(
            select(SavedSearchMatch.saved_search_id, func.count(SavedSearchMatch.id))
            .where(SavedSearchMatch.saved_search_id.in_(ids))
            .group_by(SavedSearchMatch.saved_search_id)
        ).all()
    )
    out = []
    for r in rows:
        item = SavedSearchOut.model_validate(r, from_attributes=True)
        item.latest_matches_count = counts.get(r.id, 0)
        out.append(item)
    return out


def _get_owned(db: Session, saved_search_id: int, user: UserModel) -> SavedSearch:
    saved_search = db.get(SavedSearch, saved_search_id)
    # 404 (not 403) on someone else's search — never confirm existence of a
    # saved search ID that isn't the caller's (Phase 16: prevent enumeration).
    if not saved_search or saved_search.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved search not found")
    return saved_search


# ── Literal-path routes must be declared before /{saved_search_id} ─────────

@router.post("/preview", response_model=SavedSearchPreviewResponse)
def preview_new_search(
    filters: PropertyFilterCriteriaIn,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    _rl=Depends(rate_limit_dependency("saved_search_preview", limit=60, window_seconds=60, by_user=True)),
):
    """Estimated match count + duplicate-of check for the "Save Search" UI,
    used BEFORE anything is persisted. Bounded scan — see preview_match_count."""
    criteria = _to_criteria(filters)
    count = preview_match_count(db, criteria)
    duplicate = _find_duplicate(db, current_user.id, criteria)
    return SavedSearchPreviewResponse(
        estimated_count=count,
        duplicate_of=SavedSearchDuplicateCandidate.model_validate(duplicate, from_attributes=True) if duplicate else None,
    )


@router.get("/", response_model=list[SavedSearchOut])
def list_saved_searches(
    response: Response,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias="status"),
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(SavedSearch).where(SavedSearch.user_id == current_user.id)
    if status_filter:
        stmt = stmt.where(SavedSearch.status == status_filter)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    response.headers["X-Total-Count"] = str(total)
    rows = db.scalars(stmt.order_by(SavedSearch.created_at.desc()).offset(skip).limit(limit)).all()
    return _attach_match_counts(db, rows)


@router.post("/", response_model=SavedSearchOut, status_code=status.HTTP_201_CREATED)
def create_saved_search(
    payload: SavedSearchCreate,
    response: Response,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    _rl=Depends(rate_limit_dependency("saved_search_create", limit=30, window_seconds=3600, by_user=True)),
):
    _feature_gate()
    idempotency = IdempotencyStore()
    fingerprint_payload = payload.model_dump(mode="json")
    if idempotency_key:
        try:
            existing = idempotency.begin("saved-search-create", idempotency_key, fingerprint_payload)
        except IdempotencyConflict as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        if existing is not None:
            response.status_code = existing.status_code
            return existing.body

    existing_count = db.scalar(
        select(func.count()).select_from(SavedSearch).where(SavedSearch.user_id == current_user.id, SavedSearch.status == "active")
    ) or 0
    if existing_count >= settings.SAVED_SEARCH_LIMIT_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You've reached the limit of {settings.SAVED_SEARCH_LIMIT_PER_USER} saved searches. Delete or disable one first.",
        )

    criteria = _to_criteria(payload.filters)
    if not payload.confirm_duplicate:
        duplicate = _find_duplicate(db, current_user.id, criteria)
        if duplicate is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "An identical saved search already exists.",
                    "duplicate_of": {"id": duplicate.id, "name": duplicate.name},
                },
            )

    saved_search = SavedSearch(
        name=payload.name,
        locale=payload.locale,
        filters=criteria.to_dict(),
        filter_schema_version=criteria.schema_version,
        transaction_type=criteria.transaction_type,
        city=criteria.city,
        alert_enabled=payload.alert_enabled,
        alert_frequency=payload.alert_frequency,
        channels=payload.channels,
        user_id=current_user.id,
    )
    db.add(saved_search)
    db.flush()
    record_event(
        db,
        event_type=EventType.SAVED_SEARCH_CREATED,
        aggregate_type="saved_search",
        aggregate_id=saved_search.id,
        payload={"saved_search_id": saved_search.id, "user_id": saved_search.user_id},
    )
    record_audit(db, user_id=current_user.id, action="saved_search.created", entity_type="saved_search", entity_id=saved_search.id, metadata={"alert_frequency": saved_search.alert_frequency})
    db.commit()
    db.refresh(saved_search)
    saved_searches_created_total.inc()

    out = SavedSearchOut.model_validate(saved_search, from_attributes=True)
    if idempotency_key:
        idempotency.complete("saved-search-create", idempotency_key, fingerprint_payload, status_code=201, body=out.model_dump(mode="json"))
    return out


@router.get("/{saved_search_id}", response_model=SavedSearchOut)
def get_saved_search(saved_search_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    saved_search = _get_owned(db, saved_search_id, current_user)
    return _attach_match_counts(db, [saved_search])[0]


@router.patch("/{saved_search_id}", response_model=SavedSearchOut)
def update_saved_search(
    saved_search_id: int,
    payload: SavedSearchUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    _rl=Depends(rate_limit_dependency("saved_search_update", limit=60, window_seconds=3600, by_user=True)),
):
    saved_search = _get_owned(db, saved_search_id, current_user)
    changes = payload.model_dump(exclude_unset=True)

    if "filters" in changes:
        criteria = _to_criteria(payload.filters)
        saved_search.filters = criteria.to_dict()
        saved_search.filter_schema_version = criteria.schema_version
        saved_search.transaction_type = criteria.transaction_type
        saved_search.city = criteria.city
        changes.pop("filters")

    for field, value in changes.items():
        setattr(saved_search, field, value)
    saved_search.updated_at = datetime.now(timezone.utc)

    record_event(
        db,
        event_type=EventType.SAVED_SEARCH_UPDATED,
        aggregate_type="saved_search",
        aggregate_id=saved_search.id,
        payload={"saved_search_id": saved_search.id, "user_id": saved_search.user_id},
    )
    record_audit(db, user_id=current_user.id, action="saved_search.updated", entity_type="saved_search", entity_id=saved_search.id, metadata={"fields": list(changes.keys())})
    db.commit()
    db.refresh(saved_search)
    return _attach_match_counts(db, [saved_search])[0]


@router.delete("/{saved_search_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_search(saved_search_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    saved_search = _get_owned(db, saved_search_id, current_user)
    record_audit(db, user_id=current_user.id, action="saved_search.deleted", entity_type="saved_search", entity_id=saved_search.id, metadata={})
    db.delete(saved_search)
    db.commit()


@router.post("/{saved_search_id}/enable-alerts", response_model=SavedSearchOut)
def enable_alerts(saved_search_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    saved_search = _get_owned(db, saved_search_id, current_user)
    saved_search.alert_enabled = True
    saved_search.status = "active"
    record_audit(db, user_id=current_user.id, action="saved_search.alerts_enabled", entity_type="saved_search", entity_id=saved_search.id, metadata={})
    db.commit()
    db.refresh(saved_search)
    return _attach_match_counts(db, [saved_search])[0]


@router.post("/{saved_search_id}/disable-alerts", response_model=SavedSearchOut)
def disable_alerts(saved_search_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    saved_search = _get_owned(db, saved_search_id, current_user)
    saved_search.alert_enabled = False
    # Historical matches/notifications are never touched by disabling — only
    # future matching is skipped (candidate_saved_searches filters on
    # alert_enabled). See Phase 2: "Do not delete historical notification
    # records when a saved search is disabled."
    record_audit(db, user_id=current_user.id, action="saved_search.alerts_disabled", entity_type="saved_search", entity_id=saved_search.id, metadata={})
    db.commit()
    db.refresh(saved_search)
    return _attach_match_counts(db, [saved_search])[0]


@router.post("/{saved_search_id}/preview", response_model=SavedSearchPreviewResponse)
def preview_existing_search(
    saved_search_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    _rl=Depends(rate_limit_dependency("saved_search_preview", limit=60, window_seconds=60, by_user=True)),
):
    saved_search = _get_owned(db, saved_search_id, current_user)
    criteria = PropertyFilterCriteria.from_dict(saved_search.filters)
    count = preview_match_count(db, criteria)
    return SavedSearchPreviewResponse(estimated_count=count)


@router.get("/{saved_search_id}/matches", response_model=list[SavedSearchMatchOut])
def list_matches(
    saved_search_id: int,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    saved_search = _get_owned(db, saved_search_id, current_user)
    rows = db.scalars(
        select(SavedSearchMatch)
        .where(SavedSearchMatch.saved_search_id == saved_search.id)
        .order_by(SavedSearchMatch.created_at.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return rows
