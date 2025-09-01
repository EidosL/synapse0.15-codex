"""Local retrieval tool for YaoTong orchestrator."""

from typing import Dict, Any, List

from src.eureka_rag.retrieval import retrieve_candidate_notes
from src.database import crud, database


async def retrieve_tool(query: str, top_k: int = 10) -> Dict[str, Any]:
    """Hybrid retrieval over locally stored notes.

    Args:
        query: Search query string.
        top_k: Maximum number of notes to return.

    Returns:
        {"hits": [{"note_id": str, "score": float}, ...]}
    """
    try:
        async with database.SessionLocal() as db:
            notes_db = await crud.get_notes(db, limit=1000)
            all_notes: List[Dict[str, Any]] = [
                {"id": str(n.id), "title": n.title, "content": n.content or ""}
                for n in notes_db
            ]

            note_ids = await retrieve_candidate_notes(
                [query], db, all_notes, exclude_note_id="", top_k=top_k
            )

        hits = [
            {"note_id": nid, "score": 1.0 / (idx + 1)}
            for idx, nid in enumerate(note_ids)
        ]
        return {"hits": hits}
    except Exception as e:  # pragma: no cover - defensive
        # Ensure agent does not crash if retrieval fails
        print(f"retrieve_tool error: {e}")
        return {"hits": []}
