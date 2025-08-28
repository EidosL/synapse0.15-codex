import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import crud, schemas
from src.database.database import get_db
from src.services import embedding_service

router = APIRouter(
    prefix="/api/notes",
    tags=["notes"],
)

@router.post("/", response_model=schemas.Note, status_code=status.HTTP_201_CREATED)
async def create_note_endpoint(note: schemas.NoteCreate, db: AsyncSession = Depends(get_db)):
    """
    Create a new note, generate its embeddings, and commit the transaction.
    """
    db_note = await crud.create_note(db=db, note=note)
    # The ID is available after the flush in create_note
    note_id = db_note.id

    await embedding_service.generate_and_store_embeddings_for_note(note=db_note, db=db)

    await db.commit()

    refreshed_note = await crud.get_note(db, note_id=note_id)
    return schemas.Note.model_validate(refreshed_note)

@router.get("/", response_model=List[schemas.Note])
async def read_notes_endpoint(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    """
    Retrieve all notes, with optional pagination.
    """
    notes = await crud.get_notes(db, skip=skip, limit=limit)
    return [schemas.Note.model_validate(note) for note in notes]

@router.get("/{note_id}", response_model=schemas.Note)
async def read_note_endpoint(note_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Retrieve a single note by its ID.
    """
    db_note = await crud.get_note(db, note_id=note_id)
    if db_note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return schemas.Note.model_validate(db_note)

@router.put("/{note_id}", response_model=schemas.Note)
async def update_note_endpoint(note_id: uuid.UUID, note: schemas.NoteUpdate, db: AsyncSession = Depends(get_db)):
    """
    Update an existing note, regenerate embeddings if content changed, and commit.
    """
    content_updated = note.content is not None
    db_note = await crud.update_note(db, note_id=note_id, note_update=note)

    if db_note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

    # The ID is stable, so we can capture it here.
    note_id = db_note.id

    if content_updated:
        await embedding_service.generate_and_store_embeddings_for_note(note=db_note, db=db)

    await db.commit()

    refreshed_note = await crud.get_note(db, note_id=note_id)
    return schemas.Note.model_validate(refreshed_note)

@router.delete("/{note_id}", response_model=schemas.Note)
async def delete_note_endpoint(note_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Delete a note by its ID.
    """
    # Eager load before deletion to have the data for the response
    db_note = await crud.get_note(db, note_id=note_id)
    if db_note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

    # The response model needs the object, so we validate it before deleting
    response_data = schemas.Note.model_validate(db_note)

    await crud.delete_note(db, note_id=note_id)
    await db.commit()

    return response_data
