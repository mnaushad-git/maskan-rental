from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, get_db
from app.models.property import Property
from app.models.saved_property import SavedProperty
from app.models.user import User as UserModel
from app.schemas.saved_property import SavedPropertyCreate, SavedPropertyOut, SavedPropertyUpdate

router = APIRouter()


@router.get("/", response_model=list[SavedPropertyOut])
def list_saved_properties(
    user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    stmt = select(SavedProperty).options(joinedload(SavedProperty.property)).order_by(SavedProperty.id.desc())
    if user_id is not None:
        stmt = stmt.where(SavedProperty.user_id == user_id)
    return db.scalars(stmt).unique().all()


@router.post("/", response_model=SavedPropertyOut, status_code=status.HTTP_201_CREATED)
def create_saved_property(
    payload: SavedPropertyCreate,
    _current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not db.get(UserModel, payload.user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not db.get(Property, payload.property_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    existing = db.scalar(
        select(SavedProperty).where(
            SavedProperty.user_id == payload.user_id,
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
    _current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    saved_property = db.get(SavedProperty, saved_property_id)
    if not saved_property:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved property not found")

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
    _current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    saved_property = db.get(SavedProperty, saved_property_id)
    if not saved_property:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved property not found")

    db.delete(saved_property)
    db.commit()