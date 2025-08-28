import uuid
import datetime
from pydantic import BaseModel

# Schema for creating a note (request)
class NoteCreate(BaseModel):
    title: str
    content: str | None = None

# Schema for updating a note (request)
class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = None

from typing import List

# --- Embedding Schemas ---
class EmbeddingBase(BaseModel):
    model_name: str
    vector: List[float]

class EmbeddingCreate(EmbeddingBase):
    chunk_id: uuid.UUID

class Embedding(EmbeddingBase):
    id: uuid.UUID
    chunk_id: uuid.UUID
    created_at: datetime.datetime

    model_config = {"from_attributes": True}

# --- Chunk Schemas ---
class ChunkBase(BaseModel):
    content: str

class ChunkCreate(ChunkBase):
    note_id: uuid.UUID

class Chunk(ChunkBase):
    id: uuid.UUID
    note_id: uuid.UUID
    created_at: datetime.datetime
    embedding: Embedding | None = None

    model_config = {"from_attributes": True}


# Schema for reading a note (response)
class Note(BaseModel):
    id: uuid.UUID
    title: str
    content: str | None = None
    created_at: datetime.datetime
    updated_at: datetime.datetime | None = None
    chunks: List[Chunk] = []

    model_config = {
        "from_attributes": True,
    }
