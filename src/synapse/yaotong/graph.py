"""
Knowledge graph module for YaoTong Agent.

This file defines a minimal builder interface to construct a graph from
retrieved notes. It is intentionally lightweight and can be expanded to
support richer schemas or persistence.
"""
from __future__ import annotations
from typing import Dict, Any, List, Tuple

from .models.note import Note


Graph = Dict[str, Any]


class KnowledgeGraphBuilder:
    """Builds and merges simple knowledge graphs from notes.

    The initial representation is a dict with `nodes` and `edges` lists
    to align with front-end mind map usage patterns.
    """

    def build(self, notes: List[Note]) -> Graph:
        """Construct a trivial graph where each note is a node.

        Edges are not inferred at this stage; future work can add
        entity/relation extraction and note-to-note linking.
        """
        nodes = [
            {
                "id": n.id,
                "title": n.title,
                "summary": n.get_preview(200),
                "metadata": n.metadata,
            }
            for n in notes
        ]
        return {"nodes": nodes, "edges": []}

    def merge(self, base: Graph, incoming: Graph) -> Graph:
        """Merge two graphs by id, preferring `incoming` for conflicts."""
        by_id = {n["id"]: n for n in base.get("nodes", [])}
        for n in incoming.get("nodes", []):
            by_id[n["id"]] = n
        edges = base.get("edges", []) + incoming.get("edges", [])
        return {"nodes": list(by_id.values()), "edges": edges}

