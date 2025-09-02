from typing import List, Dict
from .models import Chunk
import numpy as np


class Clusterer:
    def __init__(self, n_clusters: int = None, random_state: int = 42, max_iter: int = 50):
        """Lightweight KMeans implementation using NumPy only."""
        self.n_clusters = n_clusters
        self.random_state = random_state
        self.max_iter = max_iter

    def _init_centroids(self, X: np.ndarray, k: int) -> np.ndarray:
        rng = np.random.default_rng(self.random_state)
        idx = rng.choice(len(X), size=k, replace=False)
        return X[idx].astype(float)

    def _assign(self, X: np.ndarray, centroids: np.ndarray) -> np.ndarray:
        # Compute squared distances to each centroid
        dists = ((X[:, None, :] - centroids[None, :, :]) ** 2).sum(axis=2)
        return np.argmin(dists, axis=1)

    def _update(self, X: np.ndarray, labels: np.ndarray, k: int) -> np.ndarray:
        new_centroids = []
        for i in range(k):
            mask = labels == i
            if np.any(mask):
                new_centroids.append(X[mask].mean(axis=0))
            else:
                # Reinitialize empty cluster to a random point
                new_centroids.append(X[np.random.randint(0, len(X))])
        return np.vstack(new_centroids)

    def cluster_chunks(self, chunks: List[Chunk]) -> Dict[str, int]:
        if not chunks:
            return {}

        # Filter out chunks with missing/empty embeddings and enforce consistent dimensionality
        valid: List[Chunk] = []
        dims: List[int] = []
        for c in chunks:
            emb = getattr(c, "embedding", None)
            if emb is None:
                continue
            try:
                vec = np.asarray(emb, dtype=float).ravel()
            except Exception:
                continue
            if vec.size == 0:
                continue
            dims.append(vec.size)
            c.embedding = vec.tolist()
            valid.append(c)

        if not valid:
            return {}

        # Keep only the predominant dimensionality to avoid shape errors
        if len(set(dims)) > 1:
            # choose the most common dimension
            from collections import Counter
            target_dim, _ = Counter(dims).most_common(1)[0]
            valid = [c for c in valid if len(c.embedding) == target_dim]
            if not valid:
                return {}

        X = np.array([c.embedding for c in valid], dtype=float)
        num_chunks = len(valid)

        if self.n_clusters is None:
            k = max(5, num_chunks // 20)
            k = min(k, num_chunks)
        else:
            k = self.n_clusters

        # Unique points guard
        unique_points = np.unique(X, axis=0)
        k = min(k, len(unique_points))
        if k <= 0:
            return {}

        centroids = self._init_centroids(X, k)
        labels = None
        for _ in range(self.max_iter):
            new_labels = self._assign(X, centroids)
            if labels is not None and np.array_equal(new_labels, labels):
                break
            labels = new_labels
            centroids = self._update(X, labels, k)

        if labels is None:
            labels = np.zeros(num_chunks, dtype=int)

        return {chunk.id: int(label) for chunk, label in zip(valid, labels)}
