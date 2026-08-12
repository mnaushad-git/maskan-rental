from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db, get_mediator_user, get_optional_admin_user
from app.core.geo import coords_for
from app.models.mediator import Mediator
from app.models.project import Project
from app.models.user import User
from app.schemas.project import (
    PartnerProjectCreate,
    PartnerProjectUpdate,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
)

router = APIRouter()


@router.get("/", response_model=list[ProjectOut])
def list_projects(
    response: Response,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=1000),
    city: str | None = Query(default=None),
    area: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    include_all: bool = Query(default=False),
    admin: User | None = Depends(get_optional_admin_user),
    db: Session = Depends(get_db),
):
    filters = []
    if not include_all or admin is None:
        filters.append(Project.listing_status == "Published")
    if city:
        filters.append(Project.city.ilike(f"%{city}%"))
    if area:
        filters.append(Project.area.ilike(f"%{area}%"))
    if status_:
        filters.append(Project.status == status_)

    total = db.scalar(select(func.count()).select_from(Project).where(*filters)) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = select(Project).where(*filters).order_by(Project.id.desc()).offset(skip).limit(limit)
    return db.scalars(stmt).all()


@router.get("/partner/mine", response_model=list[ProjectOut])
def list_partner_projects(
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    return db.scalars(
        select(Project).where(Project.mediator_id == mediator.id).order_by(Project.id.desc())
    ).all()


@router.post("/partner/", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_partner_project(
    payload: PartnerProjectCreate,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    project = Project(
        **payload.model_dump(),
        listing_status="Pending Approval",
        mediator_id=mediator.id,
    )
    db.add(project)
    db.flush()
    project.latitude, project.longitude = coords_for(project.area, project.city, project.id)
    db.commit()
    db.refresh(project)
    return project


@router.patch("/partner/{project_id}", response_model=ProjectOut)
def update_partner_project(
    project_id: int,
    payload: PartnerProjectUpdate,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if project.mediator_id != mediator.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your project")

    changed_fields = payload.model_dump(exclude_unset=True)
    for field, value in changed_fields.items():
        setattr(project, field, value)
    project.listing_status = "Pending Approval"  # Re-submit for approval after any edit

    db.commit()
    db.refresh(project)
    return project


@router.post("/", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    project = Project(**payload.model_dump())
    db.add(project)
    db.flush()
    if project.latitude is None or project.longitude is None:
        project.latitude, project.longitude = coords_for(project.area, project.city, project.id)
    db.commit()
    db.refresh(project)
    return project


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    changed_fields = payload.model_dump(exclude_unset=True)
    for field, value in changed_fields.items():
        setattr(project, field, value)

    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: int,
    admin: User | None = Depends(get_optional_admin_user),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if project.listing_status != "Published" and admin is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    project.views_count = (project.views_count or 0) + 1
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}/similar", response_model=list[ProjectOut])
def get_similar_projects(
    project_id: int,
    limit: int = Query(default=6, ge=1, le=20),
    db: Session = Depends(get_db),
):
    base = db.get(Project, project_id)
    if not base:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    base_price = base.price_min or 0

    stmt = (
        select(Project)
        .where(
            Project.id != base.id,
            Project.city == base.city,
            Project.listing_status == "Published",
        )
        .order_by(
            case((Project.area == base.area, 0), else_=1),
            func.abs(func.coalesce(Project.price_min, 0) - base_price),
        )
        .limit(limit)
    )
    return db.scalars(stmt).all()
