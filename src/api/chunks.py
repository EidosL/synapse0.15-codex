from __future__ import annotations

import uuid as _uuid
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.database import get_db
from src.database import crud


router = APIRouter(
    prefix="/api/chunks",
    tags=["chunks"],
)


class ChunkResponse(BaseModel):
    chunkId: str
    noteId: str
    noteTitle: str
    content: str


@router.get("/{chunk_id}", response_model=ChunkResponse)
async def get_chunk(chunk_id: str, db: AsyncSession = Depends(get_db)):
    try:
        uid = _uuid.UUID(chunk_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid chunk id")

    rec = await crud.get_chunk_by_id(db, uid)
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chunk not found")

    note = rec.note
    return ChunkResponse(
        chunkId=str(rec.id),
        noteId=str(note.id),
        noteTitle=note.title or "Untitled",
        content=rec.content or "",
    )

