import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from . import models, schemas

async def get_note(db: AsyncSession, note_id: uuid.UUID):
    query = (
        select(models.Note)
        .options(selectinload(models.Note.chunks).selectinload(models.Chunk.embedding))
        .filter(models.Note.id == note_id)
    )
    result = await db.execute(query)
    return result.scalars().first()

async def get_notes(db: AsyncSession, skip: int = 0, limit: int = 100):
    query = (
        select(models.Note)
        .options(selectinload(models.Note.chunks).selectinload(models.Chunk.embedding))
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(query)
    return result.scalars().all()

async def create_note(db: AsyncSession, note: schemas.NoteCreate) -> models.Note:
    """Creates a new note object in the session. Does not commit."""
    db_note = models.Note(title=note.title, content=note.content)
    db.add(db_note)
    await db.flush() # Flush to assign an ID
    await db.refresh(db_note)
    return db_note

async def update_note(db: AsyncSession, note_id: uuid.UUID, note_update: schemas.NoteUpdate) -> models.Note | None:
    """Updates a note object in the session. Does not commit."""
    db_note = await get_note(db, note_id)
    if db_note:
        update_data = note_update.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_note, key, value)
        await db.flush()
        await db.refresh(db_note)
    return db_note

async def delete_note(db: AsyncSession, note_id: uuid.UUID):
    db_note = await get_note(db, note_id)
    if db_note:
        await db.delete(db_note)
        await db.commit()
    return db_note

# --- Chunk and Embedding CRUD operations ---

async def get_chunks_for_note(db: AsyncSession, note_id: uuid.UUID):
    """Retrieves all chunks associated with a given note, with their embeddings."""
    query = (
        select(models.Chunk)
        .options(selectinload(models.Chunk.embedding))
        .filter(models.Chunk.note_id == note_id)
    )
    result = await db.execute(query)
    return result.scalars().all()

async def delete_chunks_for_note(db: AsyncSession, note_id: uuid.UUID):
    """Deletes all chunks associated with a given note. Does not commit."""
    # The relationship cascade should handle deleting the embeddings as well.
    result = await db.execute(select(models.Chunk).filter(models.Chunk.note_id == note_id))
    chunks_to_delete = result.scalars().all()
    for chunk in chunks_to_delete:
        await db.delete(chunk)
    # No commit here - will be handled by the service layer

async def create_chunks_for_note(db: AsyncSession, note_id: uuid.UUID, text_chunks: list[str]) -> list[models.Chunk]:
    """Creates and stores chunk objects for a note. Does not commit."""
    db_chunks = [models.Chunk(note_id=note_id, content=text) for text in text_chunks]
    db.add_all(db_chunks)
    await db.flush() # Flush to get IDs for the new chunks
    for chunk in db_chunks:
        await db.refresh(chunk)
    return db_chunks

async def create_embeddings_for_chunks(db: AsyncSession, db_chunks: list[models.Chunk], embeddings: list[list[float]], model_name: str):
    """Creates and stores embedding objects for a list of chunks. Does not commit."""
    db_embeddings = [
        models.Embedding(chunk_id=chunk.id, vector=embedding, model_name=model_name)
        for chunk, embedding in zip(db_chunks, embeddings)
    ]
    db.add_all(db_embeddings)
    # No commit here - will be handled by the service layer

async def get_note_ids_for_chunk_ids(db: AsyncSession, chunk_ids: list[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
    """
    Takes a list of chunk IDs and returns a map of {chunk_id: note_id}.
    """
    if not chunk_ids:
        return {}

    result = await db.execute(
        select(models.Chunk.id, models.Chunk.note_id)
        .where(models.Chunk.id.in_(chunk_ids))
    )
    return {chunk_id: note_id for chunk_id, note_id in result}
