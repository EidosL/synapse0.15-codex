# synapse/yaotong/tools/local_retrieval.py
from typing import Dict, Any, List

from ..retrieval import create_retriever
from ...yaotong.models.note import NoteSearchResult

# Try to bridge to the main backend hybrid retrieval when DB is available
try:
    from src.database import crud, schemas, database  # type: ignore
    from src.eureka_rag.retrieval import (
        generate_search_queries,
        retrieve_candidate_notes,
    )  # type: ignore
    _BRIDGE_AVAILABLE = True
except Exception:
    crud = schemas = database = generate_search_queries = retrieve_candidate_notes = None  # type: ignore
    _BRIDGE_AVAILABLE = False

from src.agentscope_app.telemetry import trace


def _rank_to_score(rank: int) -> float:
    # Simple reciprocal-rank style score for UI sorting
    return 1.0 / (rank + 1)


@trace("yaotong.retrieve")
async def retrieve_tool(query: str, top_k: int = 10, depth: int = 1) -> Dict[str, Any]:
    """
    Returns a simplified hits list suitable for downstream tool composition:
    {"hits": [{"note_id": "...", "score": float}], ...}

    Prefers the application's hybrid retrieval (lexical+vector) when DB is
    available; otherwise falls back to the local keyword retriever.
    """
    if _BRIDGE_AVAILABLE:
        # Use the application's DB + hybrid retrieval for better candidates
        async for db in database.get_db():  # type: ignore[attr-defined]
            try:
                db_notes = await crud.get_notes(db, limit=1000)  # type: ignore[union-attr]
                shaped = [schemas.Note.model_validate(n).model_dump(mode="json") for n in db_notes]  # type: ignore[union-attr]
                if not shaped:
                    break

                # Generate queries from the user goal (title/content both use the query)
                queries = await generate_search_queries(query, query, max_queries=8)  # type: ignore[misc]
                cand_ids: List[str] = await retrieve_candidate_notes(  # type: ignore[misc]
                    queries=queries,
                    db=db,
                    all_notes=shaped,
                    exclude_note_id="",  # not excluding any
                    top_k=top_k,
                )
                hits = [
                    {"note_id": nid, "score": _rank_to_score(i)}
                    for i, nid in enumerate(cand_ids)
                ]
                return {"hits": hits}
            finally:
                await db.close()

    # Fallback: local keyword retriever
    retriever = create_retriever("local")
    if depth and depth > 1:
        ctx = await retriever.multi_hop_retrieve(query, depth=depth, k=top_k)
        results: List[NoteSearchResult] = ctx.results
    else:
        results = await retriever.retrieve(query, k=top_k)
    hits = [{"note_id": r.note.id, "score": r.score} for r in results]
    return {"hits": hits}
