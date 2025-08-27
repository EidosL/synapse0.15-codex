from typing import List
from .models import Chunk, ChunkInput, ClusteringResult
from .embedder import Embedder
from .clusterer import Clusterer
from .summarizer import summarize_clusters

def run_chunk_pipeline(chunks: List[ChunkInput]) -> ClusteringResult:
    """
    Runs the pipeline starting from pre-chunked data.
    """
    if not chunks:
        return ClusteringResult(chunk_to_cluster_map={}, cluster_summaries=[])

    # 1. Convert ChunkInput objects to internal Chunk objects
    # The main difference is that the internal Chunk model has an optional 'embedding' field
    internal_chunks = [Chunk(id=c.id, document_id=c.document_id, text=c.text) for c in chunks]

    # 2. Embed all chunks
    embedder = Embedder()
    chunks_with_embeddings = embedder.embed_chunks(internal_chunks)

    # 3. Cluster all chunks
    clusterer = Clusterer()
    chunk_to_cluster_map = clusterer.cluster_chunks(chunks_with_embeddings)

    # 4. Summarize each cluster
    cluster_summaries = summarize_clusters(chunks_with_embeddings, chunk_to_cluster_map)

    # 5. Return the final result
    return ClusteringResult(
        chunk_to_cluster_map=chunk_to_cluster_map,
        cluster_summaries=cluster_summaries
    )


