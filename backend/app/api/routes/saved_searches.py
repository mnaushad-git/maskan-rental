from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.saved_search import SavedSearch
from app.models.user import User as UserModel
from app.schemas.saved_search import SavedSearchCreate, SavedSearchOut, SavedSearchUpdate

router = APIRouter()


@router.get("/", response_model=list[SavedSearchOut])
def list_saved_searches(
    user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    stmt = select(SavedSearch).order_by(SavedSearch.id.desc())
    if user_id is not None:
        stmt = stmt.where(SavedSearch.user_id == user_id)
    return db.scalars(stmt).all()


@router.get("/{saved_search_id}", response_model=SavedSearchOut)
def get_saved_search(saved_search_id: int, db: Session = Depends(get_db)):
    saved_search = db.get(SavedSearch, saved_search_id)
    if not saved_search:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved search not found")
    return saved_search


@router.post("/", response_model=SavedSearchOut, status_code=status.HTTP_201_CREATED)
def create_saved_search(
    payload: SavedSearchCreate,
    _current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.get(UserModel, payload.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    saved_search = SavedSearch(**payload.model_dump())
    db.add(saved_search)
    db.commit()
    db.refresh(saved_search)
    return saved_search


@router.patch("/{saved_search_id}", response_model=SavedSearchOut)
def update_saved_search(
    saved_search_id: int,
    payload: SavedSearchUpdate,
    _current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    saved_search = db.get(SavedSearch, saved_search_id)
    if not saved_search:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved search not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(saved_search, field, value)

    db.commit()
    db.refresh(saved_search)
    return saved_search


@router.delete("/{saved_search_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_search(
    saved_search_id: int,
    _current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    saved_search = db.get(SavedSearch, saved_search_id)
    if not saved_search:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved search not found")

    db.delete(saved_search)
    db.commit()
