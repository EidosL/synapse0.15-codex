from sqlalchemy.ext.asyncio import AsyncSession
from sentence_transformers import SentenceTransformer
import numpy as np

from src.database import models, crud
from .vector_index_manager import vector_index_manager

# To prevent a warning about thread-local storage.
# See: https://github.com/huggingface/transformers/issues/18480
import os
os.environ["TOKENIZERS_PARALLELISM"] = "false"

MODEL_NAME = 'all-MiniLM-L6-v2'
model = SentenceTransformer(MODEL_NAME)

def chunk_text(text: str, max_length: int = 512, overlap: int = 50) -> list[str]:
    """
    A simple text chunking function.
    This is a basic implementation and could be improved with more sophisticated sentence boundary detection.
    """
    if not text:
        return []

    # Using a simple split for now, as in the original pipeline
    return [p.strip() for p in text.split('\n\n') if p.strip()]


async def generate_and_store_embeddings_for_note(note: models.Note, db: AsyncSession):
    """
    Chunks a note's content, generates embeddings, and stores them in the database
    and the vector index.
    """
    # 1. Get existing chunk IDs for the note to remove them from the index
    existing_chunks = await crud.get_chunks_for_note(db, note_id=note.id)
    if existing_chunks:
        existing_chunk_ids = [str(chunk.id) for chunk in existing_chunks]
        await vector_index_manager.remove_and_rebuild(ids_to_remove=existing_chunk_ids)

    # 2. Delete old chunks and embeddings from the database
    await crud.delete_chunks_for_note(db, note_id=note.id)

    # 3. Chunk the new note content
    text_chunks = chunk_text(note.content)
    if not text_chunks:
        await db.commit()
        return

    # 4. Create new Chunk objects in the database
    db_chunks = await crud.create_chunks_for_note(db, note_id=note.id, text_chunks=text_chunks)
    new_chunk_ids = [str(chunk.id) for chunk in db_chunks]

    # 5. Generate embeddings for all chunks at once
    embeddings_np = model.encode(text_chunks, convert_to_tensor=False)

    # 6. Add new vectors to the vector index
    await vector_index_manager.add(vectors=embeddings_np, db_ids=new_chunk_ids)

    # 7. Create Embedding objects in the database
    await crud.create_embeddings_for_chunks(db, db_chunks=db_chunks, embeddings=embeddings_np.tolist(), model_name=MODEL_NAME)

    await db.commit()
