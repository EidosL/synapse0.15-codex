from typing import List
from .models import Document, ClusteringResult
from .chunker import chunk_document
from .embedder import Embedder
from .clusterer import Clusterer
from .summarizer import summarize_clusters

def run_pipeline(documents: List[Document]) -> ClusteringResult:
    """
    Runs the full pipeline to process documents, cluster them, and generate summaries.
    """
    # 1. Chunk all documents into a single list
    all_chunks = []
    for doc in documents:
        all_chunks.extend(chunk_document(doc))

    if not all_chunks:
        return ClusteringResult(chunk_to_cluster_map={}, cluster_summaries=[])

    # 2. Embed all chunks
    # This might take some time depending on the number of chunks and the model.
    embedder = Embedder()
    chunks_with_embeddings = embedder.embed_chunks(all_chunks)

    # 3. Cluster all chunks based on their embeddings
    clusterer = Clusterer()
    chunk_to_cluster_map = clusterer.cluster_chunks(chunks_with_embeddings)

    # 4. Summarize each cluster
    cluster_summaries = summarize_clusters(chunks_with_embeddings, chunk_to_cluster_map)

    # 5. Return the final result containing the cluster map and summaries
    return ClusteringResult(
        chunk_to_cluster_map=chunk_to_cluster_map,
        cluster_summaries=cluster_summaries
    )
