from __future__ import annotations

from typing import Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession

from src.eureka_rag.retrieval import (
    generate_search_queries,
    retrieve_candidate_notes,
)
from src.agentscope_app.telemetry import trace


@trace("synapse.candidate_miner")
async def mine_candidates(
    source_note: Dict[str, Any],
    all_notes: List[Dict[str, Any]],
    db: AsyncSession,
    top_k: int = 10,
) -> List[Dict[str, Any]]:
    """
    Hybrid retrieval (lexical + vector) with graceful degradation.
    Returns the full note dicts for selected candidates.
    """
    queries = await generate_search_queries(
        note_title=source_note.get("title", ""),
        note_content=source_note.get("content", ""),
        max_queries=8,
    )

    candidate_ids = await retrieve_candidate_notes(
        queries=queries,
        db=db,
        all_notes=all_notes,
        exclude_note_id=source_note["id"],
        top_k=top_k,
    )

    # Fallback to lexical-only if needed (retrieve_candidate_notes already handles vector unavailability)
    id_set = set(candidate_ids)
    return [n for n in all_notes if n["id"] in id_set]
