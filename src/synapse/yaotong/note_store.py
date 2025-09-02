"""
Minimal NoteStore abstraction for YaoTong.

If the project's database layer is available (src.database), this store
will fetch real notes. Otherwise, it falls back to a no-op demo store.
"""
from __future__ import annotations
from typing import List, Optional

from .models.note import Note

try:
    # Optional integration with the app's DB layer
    from src.database import crud, schemas, database  # type: ignore
    _DB_AVAILABLE = True
except Exception:
    crud = schemas = database = None  # type: ignore
    _DB_AVAILABLE = False


class NoteStore:
    """Fetches notes by id using the app database when available."""

    def __init__(self) -> None:
        self.db_available = _DB_AVAILABLE

    async def get_notes_by_ids(self, ids: List[str]) -> List[Note]:
        if not self.db_available:
            # Fallback: return placeholder notes
            return [Note(id=i, title=f"Note {i}", content=f"Content for note {i}") for i in ids]

        # Use the DB dependency generator to acquire a session
        out: List[Note] = []
        async for db in database.get_db():  # type: ignore[attr-defined]
            try:
                # Batch fetch: crud has get_notes(limit), not batch by ids, so fetch all within a cap
                db_notes = await crud.get_notes(db, limit=1000)  # type: ignore[union-attr]
                # Project's schemas.Note can be used to ensure consistent shapes
                shaped = [schemas.Note.model_validate(n) for n in db_notes]  # type: ignore[union-attr]
                by_id = {str(n.id): n for n in shaped}
                for i in ids:
                    if i in by_id:
                        sn = by_id[i]
                        # Prefer full note content; otherwise stitch chunks (oldest->newest)
                        if sn.content:
                            content = sn.content
                        else:
                            ordered = sorted(sn.chunks, key=lambda c: getattr(c, "created_at", None) or 0)
                            content = "\n\n".join([c.content for c in ordered])
                        out.append(Note(id=str(sn.id), title=sn.title, content=content))
            finally:
                await db.close()
        return out

    async def get_all(self, limit: int = 100) -> List[Note]:
        if not self.db_available:
            return []
        out: List[Note] = []
        async for db in database.get_db():  # type: ignore[attr-defined]
            try:
                db_notes = await crud.get_notes(db, limit=limit)  # type: ignore[union-attr]
                shaped = [schemas.Note.model_validate(n) for n in db_notes]  # type: ignore[union-attr]
                for sn in shaped:
                    if sn.content:
                        content = sn.content
                    else:
                        ordered = sorted(sn.chunks, key=lambda c: getattr(c, "created_at", None) or 0)
                        content = "\n\n".join([c.content for c in ordered])
                    out.append(Note(id=str(sn.id), title=sn.title, content=content))
            finally:
                await db.close()
        return out
