from __future__ import annotations

from typing import List, Tuple
import numpy as np

from src.services.vector_index_manager import vector_index_manager
from src.agentscope_app.telemetry import trace


class FaissStore:
    """Thin wrapper over the global vector index manager."""

    @trace("synapse.tools.faiss.add")
    async def add(self, vectors: np.ndarray, ids: List[str]) -> None:
        await vector_index_manager.add(vectors=vectors, db_ids=ids)

    @trace("synapse.tools.faiss.search")
    async def search(self, query_vector: np.ndarray, top_k: int) -> List[Tuple[str, float]]:
        return await vector_index_manager.search(query_vector=query_vector, k=top_k)

    @trace("synapse.tools.faiss.remove")
    async def remove(self, ids_to_remove: List[str]) -> None:
        await vector_index_manager.remove_and_rebuild(ids_to_remove=ids_to_remove)


faiss_store = FaissStore()
