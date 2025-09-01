# synapse/yaotong/tools/local_retrieval.py
from typing import Dict, Any

# Replace the TODO with your repo's retrieval entrypoint.
# e.g., existing hybrid retrieval (lexical + vector + RRF)
async def retrieve_tool(query: str, top_k: int = 10) -> Dict[str, Any]:
    """
    Returns: {"hits": [{"note_id": "...", "score": ...}, ...]}
    """
    # TODO: call your current retrieval function:
    # hits = await retrieval.search(query, top_k=top_k)
    hits = [{"note_id":"demo-1","score":0.91},{"note_id":"demo-2","score":0.87}]
    return {"hits": hits}
