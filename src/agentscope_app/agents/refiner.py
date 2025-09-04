from __future__ import annotations

import uuid
from sqlalchemy.ext.asyncio import AsyncSession

import os
from src.database import crud, models
from src.services import embedding_service
from src.agentscope_app.tools.faiss_store import faiss_store
from src.agentscope_app.telemetry import trace
from src.synapse.yaotong.models.note import Note as YTNote
from src.synapse.yaotong.agents.refiner_agent import select_or_synthesize_template, distill_markdown


@trace("synapse.refiner")
async def refine_note(note: models.Note, db: AsyncSession) -> None:
    """Chunk, embed, and index a note (idempotent for updates)."""
    await embedding_service.generate_and_store_embeddings_for_note(note=note, db=db)
    # Attempt LLM-powered template distillation and index as an extra chunk
    try:
        # Skip LLM distillation in tests/dev to avoid network delays
        if os.getenv("PYTEST_CURRENT_TEST") or os.getenv("EMBEDDINGS_FAKE") == "1" or (os.getenv("GOOGLE_API_KEY") in {None, "test-key", "TEST", "dummy"} and os.getenv("GEMINI_API_KEY") in {None, "test-key", "TEST", "dummy"}):
            return
        ytn = YTNote(id=str(note.id), title=note.title or "", content=note.content or "")
        # Gather original chunks for index linking
        originals = await crud.get_chunks_for_note(db, note_id=note.id)
        # Excerpt first lines as snippet
        index_refs = []
        for c in originals[:20]:
            text = (c.content or "").strip()
            index_refs.append((str(c.id), text[:240]))
        tmpl = await select_or_synthesize_template(ytn)
        distilled = await distill_markdown(ytn, tmpl, index_refs) if tmpl else None
        if distilled:
            # Create one distilled chunk and embed
            new_chunks = await crud.create_chunks_for_note(db, note_id=note.id, text_chunks=[distilled])
            from src.util.genai_compat import embed_texts
            vecs = await embed_texts('text-embedding-004', [distilled])
            await crud.create_embeddings_for_chunks(db, db_chunks=new_chunks, embeddings=vecs, model_name='text-embedding-004')
            import numpy as np
            await faiss_store.add(np.array(vecs, dtype='float32'), [str(c.id) for c in new_chunks])
            await db.flush()
    except Exception as e:
        # Non-fatal: distillation is opportunistic
        print(f"Refiner distillation skipped: {e}")


@trace("synapse.refiner.remove")
async def remove_note_from_index(note_id: uuid.UUID, db: AsyncSession) -> None:
    """Remove a note's vectors from FAISS and delete chunks in DB before deletion."""
    chunks = await crud.get_chunks_for_note(db, note_id=note_id)
    if chunks:
        await faiss_store.remove([str(c.id) for c in chunks])
    await crud.delete_chunks_for_note(db, note_id=note_id)
