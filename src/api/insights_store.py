from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
import uuid

from src.database.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from src.database import crud, schemas, models
from pydantic import BaseModel
from src.services.filesync import export_insights_to_folder, export_insight_to_folder
import datetime

router = APIRouter(prefix="/api/insights", tags=["insights"])


@router.get("/", response_model=List[schemas.Insight])
async def list_all_insights(db: AsyncSession = Depends(get_db)):
    records = await crud.list_insights(db)
    return [schemas.Insight.model_validate(r) for r in records]


@router.get("/by-note/{note_id}", response_model=List[schemas.Insight])
async def list_insights_for_note(note_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    records = await crud.list_insights(db, new_note_id=note_id)
    return [schemas.Insight.model_validate(r) for r in records]


class BulkCreateRequest(BaseModel):
    items: List[schemas.InsightCreate]


@router.post("/bulk", response_model=List[schemas.Insight])
async def create_bulk(req: BulkCreateRequest, db: AsyncSession = Depends(get_db)):
    records = await crud.create_insights_bulk(db, req.items)
    await db.commit()
    # Export to filesystem as Markdown
    try:
        export_insights_to_folder(records)  # best-effort
    except Exception:
        pass
    return [schemas.Insight.model_validate(r) for r in records]


@router.patch("/{insight_id}", response_model=schemas.Insight)
async def update_insight(insight_id: uuid.UUID, update: schemas.InsightUpdate, db: AsyncSession = Depends(get_db)):
    rec = await crud.update_insight(db, insight_id, update)
    if not rec:
        raise HTTPException(status_code=404, detail="Insight not found")
    await db.commit()
    try:
        export_insight_to_folder(rec)
    except Exception:
        pass
    return schemas.Insight.model_validate(rec)


class ExportOnlyItem(BaseModel):
    new_note_id: uuid.UUID
    old_note_id: Optional[str] = None
    status: Optional[str] = "new"
    payload: dict


@router.post("/export-only")
async def export_only(items: List[ExportOnlyItem]):
    # Create lightweight objects that mimic the ORM shape for exporter
    class _Stub:
        def __init__(self, i: ExportOnlyItem):
            self.id = uuid.uuid4()
            self.new_note_id = i.new_note_id
            self.old_note_id = i.old_note_id
            self.status = i.status or "new"
            self.payload = i.payload
            self.created_at = datetime.datetime.now(datetime.timezone.utc)
            self.updated_at = None

    stubs = [_Stub(i) for i in items]
    try:
        export_insights_to_folder(stubs)  # best-effort
    except Exception:
        pass
    # Return a minimal echo list with assigned IDs
    return [{
        "id": str(s.id),
        "new_note_id": str(s.new_note_id),
        "old_note_id": s.old_note_id,
        "status": s.status,
        "payload": s.payload,
        "created_at": s.created_at.isoformat(),
        "updated_at": None,
    } for s in stubs]
