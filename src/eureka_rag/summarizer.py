from typing import List, Dict
from .models import Chunk, ClusterSummary

def summarize_clusters(
    chunks: List[Chunk],
    chunk_to_cluster_map: Dict[str, int]
) -> List[ClusterSummary]:
    """
    Generates a simple summary for each cluster by concatenating the text of the first few chunks.

    TODO: Replace this with a real LLM call for summarization for more meaningful summaries.
    """
    if not chunk_to_cluster_map:
        return []

    # Group chunks by cluster id
    clusters: Dict[int, List[str]] = {}
    for chunk in chunks:
        cluster_id = chunk_to_cluster_map.get(chunk.id)
        if cluster_id is not None:
            clusters.setdefault(cluster_id, []).append(chunk.text)

    summaries = []
    for cluster_id, cluster_chunks in clusters.items():
        # For now, we concatenate the first 3 chunks or up to 500 characters.
        summary_text = " ".join(cluster_chunks[:3])
        if len(summary_text) > 500:
            summary_text = summary_text[:500] + "..."

        # A simple fallback if the summary is empty
        if not summary_text.strip():
            summary_text = f"Cluster {cluster_id} - contains {len(cluster_chunks)} chunks."

        summaries.append(ClusterSummary(cluster_id=cluster_id, summary=summary_text))

    return summaries
