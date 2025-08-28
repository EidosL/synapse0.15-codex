import pytest
from src.eureka_rag.summarizer import summarize_clusters
from src.eureka_rag.models import Chunk, ClusterSummary

def test_summarize_clusters_empty_input():
    """Tests that the function returns an empty list when given no clusters."""
    result = summarize_clusters(chunks=[], chunk_to_cluster_map={})
    assert result == []

def test_summarize_clusters_basic_case():
    """Tests the basic summarization of a single cluster."""
    chunks = [
        Chunk(id="c1", document_id="d1", text="First part."),
        Chunk(id="c2", document_id="d1", text="Second part."),
    ]
    cluster_map = {"c1": 0, "c2": 0}

    result = summarize_clusters(chunks, cluster_map)

    assert len(result) == 1
    assert result[0].cluster_id == 0
    assert result[0].summary == "First part. Second part."

def test_summarize_clusters_multiple_clusters():
    """Tests summarization with multiple distinct clusters."""
    chunks = [
        Chunk(id="c1", document_id="d1", text="Cluster 0 text."),
        Chunk(id="c2", document_id="d1", text="Cluster 1 text."),
        Chunk(id="c3", document_id="d1", text="More cluster 0 text."),
    ]
    cluster_map = {"c1": 0, "c2": 1, "c3": 0}

    result = summarize_clusters(chunks, cluster_map)

    # Sort by cluster_id to have a deterministic order for assertions
    result.sort(key=lambda s: s.cluster_id)

    assert len(result) == 2

    assert result[0].cluster_id == 0
    assert result[0].summary == "Cluster 0 text. More cluster 0 text."

    assert result[1].cluster_id == 1
    assert result[1].summary == "Cluster 1 text."

def test_summarize_clusters_truncation():
    """Tests that long summaries are truncated to 500 characters."""
    long_text = "a" * 600
    chunks = [Chunk(id="c1", document_id="d1", text=long_text)]
    cluster_map = {"c1": 0}

    result = summarize_clusters(chunks, cluster_map)

    assert len(result) == 1
    assert len(result[0].summary) == 503 # 500 chars + "..."
    assert result[0].summary.endswith("...")

def test_summarize_clusters_only_three_chunks_used():
    """Tests that only the first three chunks are used for the summary."""
    chunks = [
        Chunk(id="c1", document_id="d1", text="one"),
        Chunk(id="c2", document_id="d1", text="two"),
        Chunk(id="c3", document_id="d1", text="three"),
        Chunk(id="c4", document_id="d1", text="four"),
    ]
    cluster_map = {"c1": 0, "c2": 0, "c3": 0, "c4": 0}

    result = summarize_clusters(chunks, cluster_map)

    assert len(result) == 1
    assert result[0].summary == "one two three"

def test_summarize_clusters_fallback_summary():
    """Tests the fallback summary for clusters with empty/whitespace text."""
    chunks = [
        Chunk(id="c1", document_id="d1", text=" "),
        Chunk(id="c2", document_id="d1", text="\t"),
    ]
    cluster_map = {"c1": 0, "c2": 0}

    result = summarize_clusters(chunks, cluster_map)

    assert len(result) == 1
    assert result[0].summary == "Cluster 0 - contains 2 chunks."
