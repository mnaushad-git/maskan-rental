from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.project import Project
from app.schemas.project import ProjectOut

router = APIRouter()


@router.get("/", response_model=list[ProjectOut])
def list_projects(
    response: Response,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=1000),
    city: str | None = Query(default=None),
    area: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
):
    filters = []
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


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
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
        .where(Project.id != base.id, Project.city == base.city)
        .order_by(
            case((Project.area == base.area, 0), else_=1),
            func.abs(func.coalesce(Project.price_min, 0) - base_price),
        )
        .limit(limit)
    )
    return db.scalars(stmt).all()
