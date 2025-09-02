from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.database import get_db
from src.database import crud
from src.services.filesync import (
    import_notes_from_folder,
    export_insights_to_folder,
    load_config,
    save_config,
    get_paths,
    read_insights_from_folder,
)

router = APIRouter(prefix="/api/filesync", tags=["filesync"])


@router.post("/import-notes")
async def import_notes(db: AsyncSession = Depends(get_db)):
    count = await import_notes_from_folder(db)
    return {"imported": count}


@router.post("/export-insights")
async def export_insights(db: AsyncSession = Depends(get_db)):
    records = await crud.list_insights(db)
    export_insights_to_folder(records)
    return {"exported": len(records)}


@router.get("/config")
async def get_config():
    cfg = load_config()
    notes_dir, insights_dir = get_paths()
    cfg['notes_dir'] = notes_dir
    cfg['insights_dir'] = insights_dir
    return cfg


@router.post("/config")
async def set_config(payload: dict):
    cfg = load_config()
    # Merge only known keys
    for k in ["notes_dir", "insights_dir", "watch_interval_sec"]:
        if k in payload and payload[k]:
            cfg[k] = payload[k]
    save_config(cfg)
    # Ensure directories exist
    _ = get_paths()  # triggers ensure via clients where needed
    return cfg


@router.get("/insights-from-files")
async def insights_from_files():
    return read_insights_from_folder()
