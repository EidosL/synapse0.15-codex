import pytest
from unittest.mock import MagicMock, patch
from src.eureka_rag.main import run_chunk_pipeline
from src.eureka_rag.models import ChunkInput, ClusteringResult, ClusterSummary

@patch('src.eureka_rag.main.summarize_clusters')
@patch('src.eureka_rag.main.Clusterer')
@patch('src.eureka_rag.main.Embedder')
def test_run_chunk_pipeline_orchestration(MockEmbedder, MockClusterer, mock_summarize_clusters):
    """
    Integration test for run_chunk_pipeline to ensure it correctly
    orchestrates the embedding, clustering, and summarization steps.
    """
    # 1. Arrange: Set up the mocks for each step of the pipeline

    # Mock for Embedder
    mock_embedder_instance = MagicMock()
    # Simulate that the embedder adds an embedding to each chunk
    def embed_side_effect(chunks):
        for chunk in chunks:
            chunk.embedding = [0.1, 0.2] # Dummy embedding
        return chunks
    mock_embedder_instance.embed_chunks.side_effect = embed_side_effect
    MockEmbedder.return_value = mock_embedder_instance

    # Mock for Clusterer
    mock_clusterer_instance = MagicMock()
    mock_cluster_map = {'c1': 0, 'c2': 0}
    mock_clusterer_instance.cluster_chunks.return_value = mock_cluster_map
    MockClusterer.return_value = mock_clusterer_instance

    # Mock for summarize_clusters function
    mock_summaries = [ClusterSummary(cluster_id=0, summary="A summary of cluster 0")]
    mock_summarize_clusters.return_value = mock_summaries

    # Prepare the input data for the pipeline
    chunk_inputs = [
        ChunkInput(id="c1", document_id="d1", text="This is the first chunk."),
        ChunkInput(id="c2", document_id="d1", text="This is the second chunk."),
    ]

    # 2. Act: Run the pipeline
    result = run_chunk_pipeline(chunk_inputs)

    # 3. Assert: Verify that each component was called correctly and in order

    # Verify Embedder was called
    MockEmbedder.assert_called_once()
    mock_embedder_instance.embed_chunks.assert_called_once()

    # Verify Clusterer was called with the chunks that have embeddings
    MockClusterer.assert_called_once()
    chunks_for_clustering = mock_clusterer_instance.cluster_chunks.call_args[0][0]
    assert len(chunks_for_clustering) == 2
    assert chunks_for_clustering[0].id == "c1"
    assert chunks_for_clustering[0].embedding == [0.1, 0.2]

    # Verify Summarizer was called with the results from the previous steps
    mock_summarize_clusters.assert_called_once_with(chunks_for_clustering, mock_cluster_map)

    # Verify the final output of the pipeline
    assert isinstance(result, ClusteringResult)
    assert result.chunk_to_cluster_map == mock_cluster_map
    assert result.cluster_summaries == mock_summaries

def test_run_chunk_pipeline_empty_input():
    """
    Tests that the pipeline correctly handles an empty list of chunks
    and returns an empty result without calling any processing steps.
    """
    result = run_chunk_pipeline([])
    assert isinstance(result, ClusteringResult)
    assert result.chunk_to_cluster_map == {}
    assert result.cluster_summaries == []
