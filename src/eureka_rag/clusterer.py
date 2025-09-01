from typing import List, Dict
from .models import Chunk
from sklearn.cluster import KMeans
import numpy as np

class Clusterer:
    def __init__(self, n_clusters: int = None, random_state: int = 42):
        """
        Initializes the clusterer.
        n_clusters can be specified, otherwise it will be determined heuristically.
        """
        self.n_clusters = n_clusters
        self.random_state = random_state

    def cluster_chunks(self, chunks: List[Chunk]) -> Dict[str, int]:
        """
        Performs KMeans clustering on a list of chunks with embeddings.
        Returns a dictionary mapping chunk_id to its assigned cluster_id.
        """
        if not chunks or not chunks[0].embedding:
            return {}

        embeddings = np.array([chunk.embedding for chunk in chunks])

        num_chunks = len(chunks)
        if self.n_clusters is None:
            # Heuristic from the user's document
            n_clusters = max(5, num_chunks // 20)
            # Ensure we don't have more clusters than chunks
            n_clusters = min(n_clusters, num_chunks)
        else:
            n_clusters = self.n_clusters

        # Ensure we don't request more clusters than distinct points
        unique_points = np.unique(embeddings, axis=0)
        n_clusters = min(n_clusters, len(unique_points))

        if n_clusters <= 0:
            return {}

        kmeans = KMeans(n_clusters=n_clusters, random_state=self.random_state, n_init='auto')
        labels = kmeans.fit_predict(embeddings)

        chunk_to_cluster_map = {chunk.id: int(label) for chunk, label in zip(chunks, labels)}

        return chunk_to_cluster_map
