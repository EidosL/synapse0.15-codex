import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import crud, schemas
from src.database.database import get_db
from src.services.vector_index_manager import vector_index_manager

router = APIRouter(
    prefix="/api/search",
    tags=["search"],
)

class SearchRequest(BaseModel):
    note_id: uuid.UUID
    k: int = 10

class SearchResult(BaseModel):
    chunk_id: str
    score: float

@router.post("/similar_chunks", response_model=List[SearchResult])
async def find_similar_chunks(req: SearchRequest, db: AsyncSession = Depends(get_db)):
    """
    Finds the most similar chunks to the chunks of a given note.
    It computes an average vector for the source note and uses that to query the index.
    """
    source_chunks = await crud.get_chunks_for_note(db, note_id=req.note_id)
    if not source_chunks:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source note has no content or chunks.")

    # Get embeddings for the source chunks
    source_embeddings = []
    for chunk in source_chunks:
        # This assumes a chunk has one embedding. The relationship is one-to-one.
        if chunk.embedding:
            source_embeddings.append(chunk.embedding.vector)

    if not source_embeddings:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source note chunks have no embeddings.")

    # Compute the average vector for the source note
    query_vector = np.mean(np.array(source_embeddings), axis=0).reshape(1, -1)

    # Search the vector index, requesting more results to filter out the source note's own chunks
    # We add the number of source chunks to k to have a buffer for filtering
    search_results = await vector_index_manager.search(query_vector=query_vector, k=req.k + len(source_chunks))

    # Filter out chunks from the source note itself
    source_chunk_ids = {str(chunk.id) for chunk in source_chunks}
    final_results = []
    for chunk_id, score in search_results:
        if chunk_id not in source_chunk_ids:
            final_results.append(SearchResult(chunk_id=chunk_id, score=score))
        if len(final_results) == req.k:
            break

    return final_results
