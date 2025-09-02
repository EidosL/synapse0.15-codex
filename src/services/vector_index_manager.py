import faiss
import numpy as np
import os
import asyncio
import json
from typing import List, Tuple

class VectorIndexManager:
    """
    Manages a FAISS index for vector search, including thread-safe operations
    and persistence.
    """
    def __init__(self, index_path: str | None = None, mapping_path: str | None = None, dimension: int = 768):
        data_dir = os.getenv("SYNAPSE_DATA_DIR", ".")
        # Allow overriding via env, else place alongside DB in data dir
        self.index_path = index_path or os.getenv("VECTOR_INDEX_PATH", os.path.join(data_dir, "faiss_index.bin"))
        self.mapping_path = mapping_path or os.getenv("VECTOR_ID_MAPPING_PATH", os.path.join(data_dir, "id_mapping.json"))
        self.dimension = dimension
        self._lock = asyncio.Lock()

        # This list maps the internal, sequential FAISS IDs (0, 1, 2...) to our database UUIDs.
        self.faiss_id_to_db_id: List[str] = []

        self._load()

    def _load(self):
        """Loads the index and ID mapping from disk."""
        print("Loading FAISS index and ID mapping...")
        if os.path.exists(self.index_path) and os.path.exists(self.mapping_path):
            self.index = faiss.read_index(self.index_path)
            try:
                # Align configured dimension with loaded index
                self.dimension = getattr(self.index, 'd', self.dimension)
            except Exception:
                pass
            with open(self.mapping_path, 'r') as f:
                self.faiss_id_to_db_id = json.load(f)
            print(f"Loaded index with {self.index.ntotal} vectors.")
        else:
            print("Creating new FAISS index.")
            self.index = faiss.IndexFlatL2(self.dimension)
            self.faiss_id_to_db_id = []

    async def save(self):
        """Saves the index and ID mapping to disk."""
        async with self._lock:
            print(f"Saving FAISS index with {self.index.ntotal} vectors to {self.index_path}")
            faiss.write_index(self.index, self.index_path)
            with open(self.mapping_path, 'w') as f:
                json.dump(self.faiss_id_to_db_id, f)

    async def add(self, vectors: np.ndarray, db_ids: List[str]):
        """Adds vectors and their corresponding database IDs to the index."""
        if vectors.shape[1] != self.dimension:
            raise ValueError(f"Vector dimension mismatch. Expected {self.dimension}, got {vectors.shape[1]}")

        async with self._lock:
            start_index = self.index.ntotal
            self.index.add(vectors.astype('float32'))
            self.faiss_id_to_db_id.extend(db_ids)

            # Sanity check
            if self.index.ntotal != len(self.faiss_id_to_db_id):
                print("Warning: Index size and ID mapping are out of sync!")

    async def search(self, query_vector: np.ndarray, k: int) -> List[Tuple[str, float]]:
        """Searches for the k nearest neighbors to a query vector."""
        if not self.index.ntotal:
            return []

        async with self._lock:
            distances, indices = self.index.search(query_vector.astype('float32'), k)

            results = []
            for i in range(indices.shape[1]):
                faiss_id = indices[0][i]
                if faiss_id != -1:
                    db_id = self.faiss_id_to_db_id[faiss_id]
                    score = distances[0][i]
                    results.append((db_id, score))
            return results

    async def remove_and_rebuild(self, ids_to_remove: List[str]):
        """
        Removes vectors by their database IDs and rebuilds the index.
        NOTE: This is inefficient. For production systems, a more sophisticated
        approach (e.g., using IndexIDMap or periodic full rebuilds) is needed.
        """
        async with self._lock:
            # Find the FAISS indices to keep
            ids_to_remove_set = set(ids_to_remove)
            indices_to_keep = [i for i, db_id in enumerate(self.faiss_id_to_db_id) if db_id not in ids_to_remove_set]

            if len(indices_to_keep) == len(self.faiss_id_to_db_id):
                return # Nothing to remove

            print(f"Rebuilding index. Removing {len(ids_to_remove)} vectors...")

            # Create a new index with the vectors to keep
            new_index = faiss.IndexFlatL2(self.dimension)
            new_id_map = [self.faiss_id_to_db_id[i] for i in indices_to_keep]

            if indices_to_keep:
                vectors_to_keep = np.array([self.index.reconstruct(i) for i in indices_to_keep])
                new_index.add(vectors_to_keep)

            self.index = new_index
            self.faiss_id_to_db_id = new_id_map
            print("Index rebuild complete.")


# Global instance of the index manager
vector_index_manager = VectorIndexManager()
