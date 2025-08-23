from typing import List
from .models import Document, Chunk, ChunkInput, ClusteringResult
from .chunker import chunk_document
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

    # The rest of the pipeline is the same as run_chunk_pipeline, but starting from generated chunks
    # We can reuse the logic by converting the generated chunks to ChunkInput format,
    # though it's a bit redundant. A better refactor would be to have a common function.
    # For now, this is fine.
    chunk_inputs = [ChunkInput(id=c.id, document_id=c.document_id, text=c.text) for c in all_chunks]

    return run_chunk_pipeline(chunk_inputs)
