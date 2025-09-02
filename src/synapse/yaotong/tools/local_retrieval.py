# synapse/yaotong/tools/local_retrieval.py
from typing import Dict, Any

from ..retrieval import create_retriever


# Local retrieval tool adapter for the orchestrator tool bus.
# Bridges tool-style calls to the class-based retriever implementation.
async def retrieve_tool(query: str, top_k: int = 10, depth: int = 1) -> Dict[str, Any]:
    """
    Returns a simplified hits list suitable for downstream tool composition:
    {"hits": [{"note_id": "...", "score": float}], ...}
    """
    retriever = create_retriever("local")
    if depth and depth > 1:
        ctx = await retriever.multi_hop_retrieve(query, depth=depth, k=top_k)
        results = ctx.results
    else:
        results = await retriever.retrieve(query, k=top_k)
    hits = [{"note_id": r.note.id, "score": r.score} for r in results]
    return {"hits": hits}
