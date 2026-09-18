from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, get_db
from app.models.property import Property
from app.models.saved_property import SavedProperty
from app.models.user import User as UserModel
from app.schemas.saved_property import SavedPropertyCreate, SavedPropertyOut, SavedPropertyUpdate

router = APIRouter()


def _get_owned(db: Session, saved_property_id: int, user: UserModel) -> SavedProperty:
    saved_property = db.get(SavedProperty, saved_property_id)
    # 404 (not 403) on someone else's saved property — never confirm existence
    # of a saved-property ID that isn't the caller's (same enumeration-safe
    # pattern as saved_searches.py's _get_owned).
    if not saved_property or saved_property.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved property not found")
    return saved_property


@router.get("/", response_model=list[SavedPropertyOut])
def list_saved_properties(
    user_id: int | None = Query(default=None),
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # `user_id` is accepted for backward compatibility with existing callers
    # (which always pass the caller's own id) but is otherwise ignored: the
    # list is always scoped to the authenticated caller, never to an
    # arbitrary/unauthenticated user_id.
    if user_id is not None and user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot list another user's saved properties")
    stmt = (
        select(SavedProperty)
        .options(joinedload(SavedProperty.property))
        .where(SavedProperty.user_id == current_user.id)
        .order_by(SavedProperty.id.desc())
    )
    return db.scalars(stmt).unique().all()


@router.post("/", response_model=SavedPropertyOut, status_code=status.HTTP_201_CREATED)
def create_saved_property(
    payload: SavedPropertyCreate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot save a property for another user")
    if not db.get(Property, payload.property_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    existing = db.scalar(
        select(SavedProperty).where(
            SavedProperty.user_id == current_user.id,
            SavedProperty.property_id == payload.property_id,
        )
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Property already saved")

    saved_property = SavedProperty(**payload.model_dump())
    db.add(saved_property)
    db.commit()
    return db.scalar(
        select(SavedProperty)
        .options(joinedload(SavedProperty.property))
        .where(SavedProperty.id == saved_property.id)
    )


@router.patch("/{saved_property_id}", response_model=SavedPropertyOut)
def update_saved_property(
    saved_property_id: int,
    payload: SavedPropertyUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    saved_property = _get_owned(db, saved_property_id, current_user)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(saved_property, field, value)

    db.commit()
    return db.scalar(
        select(SavedProperty)
        .options(joinedload(SavedProperty.property))
        .where(SavedProperty.id == saved_property.id)
    )


@router.delete("/{saved_property_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_property(
    saved_property_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    saved_property = _get_owned(db, saved_property_id, current_user)

    db.delete(saved_property)
    db.commit()