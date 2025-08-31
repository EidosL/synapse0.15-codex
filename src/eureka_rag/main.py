from typing import List
from .models import Chunk, ChunkInput, ClusteringResult
from .embedder import Embedder
from .clusterer import Clusterer
from .summarizer import summarize_clusters

def run_chunk_pipeline(chunks: List[ChunkInput]) -> ClusteringResult:
    """
    Runs the Eureka RAG (Retrieval-Augmented Generation) pipeline to discover
    thematic clusters in a collection of text chunks.

    This pipeline processes a list of text chunks from various documents,
    embeds them into a vector space, groups them into clusters based on
    semantic similarity, and then generates a descriptive summary for each cluster.

    This serves as the main entrypoint for the backend insight discovery process,
    which has replaced the older `findSynapticLink` function previously found in
    the TypeScript codebase.

    Args:
        chunks: A list of `ChunkInput` objects, each representing a segment of text
                from a document.

    Returns:
        A `ClusteringResult` object containing two key pieces of information:
        1. `chunk_to_cluster_map`: A dictionary mapping each chunk's ID to the
           ID of the cluster it belongs to.
        2. `cluster_summaries`: A list of `ClusterSummary` objects, each containing
           the cluster ID, a generated summary, and the IDs of the chunks in it.
    """
    if not chunks:
        return ClusteringResult(chunk_to_cluster_map={}, cluster_summaries=[])

    # Step 1: Convert input data to the internal `Chunk` model.
    # This internal model is used throughout the pipeline and can hold state
    # like the chunk's vector embedding.
    internal_chunks = [Chunk(id=c.id, document_id=c.document_id, text=c.text) for c in chunks]

    # Step 2: Embed all text chunks into a high-dimensional vector space.
    # This is a crucial step for understanding the semantic meaning of the text.
    embedder = Embedder()
    chunks_with_embeddings = embedder.embed_chunks(internal_chunks)

    # Step 3: Cluster the embedded chunks.
    # This groups semantically similar chunks together, forming the basis for our insights.
    clusterer = Clusterer()
    chunk_to_cluster_map = clusterer.cluster_chunks(chunks_with_embeddings)

    # Step 4: Summarize each cluster to extract the core theme or insight.
    # An LLM is used to generate a human-readable summary for each group of chunks.
    cluster_summaries = summarize_clusters(chunks_with_embeddings, chunk_to_cluster_map)

    # Step 5: Return the final result, including the cluster assignments and summaries.
    return ClusteringResult(
        chunk_to_cluster_map=chunk_to_cluster_map,
        cluster_summaries=cluster_summaries
    )


