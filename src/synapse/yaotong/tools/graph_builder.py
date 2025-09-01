from __future__ import annotations
from typing import List, Dict
from database.schemas import Note

async def build_graph(notes: List[Note]) -> Dict:
    """Build a simple graph placeholder from notes."""
    nodes = [{"id": str(n.id), "title": n.title} for n in notes]
    edges: List[Dict[str, str]] = []
    return {"nodes": nodes, "edges": edges}

# Expose as tool entry point
graph_builder_tool = build_graph
