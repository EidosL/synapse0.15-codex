import pytest
from unittest.mock import MagicMock
from src.eureka_rag.clusterer import Clusterer
from src.eureka_rag.models import Chunk
import numpy as np

def create_dummy_chunks(count):
    """Helper function to create a list of dummy chunks with embeddings."""
    chunks = []
    for i in range(count):
        chunks.append(
            Chunk(id=f"c{i}", document_id="d1", text=f"text {i}", embedding=[float(i), float(i + 1)])
        )
    return chunks

@pytest.fixture
def mock_kmeans(mocker):
    """Mocks the sklearn KMeans class."""
    mock_instance = MagicMock()
    # Configure fit_predict to return a predictable sequence of labels
    mock_instance.fit_predict.return_value = np.array([i % 5 for i in range(200)]) # Returns 0,1,2,3,4,0,1,2,3,4...

    mock_constructor = mocker.patch('src.eureka_rag.clusterer.KMeans', return_value=mock_instance)
    return mock_constructor, mock_instance

def test_cluster_chunks_empty_list(mock_kmeans):
    """Tests that clustering an empty list of chunks returns an empty map."""
    clusterer = Clusterer()
    result = clusterer.cluster_chunks([])
    assert result == {}
    mock_constructor, _ = mock_kmeans
    mock_constructor.assert_not_called()

def test_cluster_chunks_no_embeddings(mock_kmeans):
    """Tests that clustering chunks without embeddings returns an empty map."""
    clusterer = Clusterer()
    chunks_no_embedding = [Chunk(id="c1", document_id="d1", text="text")]
    result = clusterer.cluster_chunks(chunks_no_embedding)
    assert result == {}
    mock_constructor, _ = mock_kmeans
    mock_constructor.assert_not_called()

def test_cluster_with_fixed_n_clusters(mock_kmeans):
    """Tests clustering with a manually specified number of clusters."""
    mock_constructor, mock_instance = mock_kmeans

    clusterer = Clusterer(n_clusters=10)
    chunks = create_dummy_chunks(50)

    result = clusterer.cluster_chunks(chunks)

    # Assert KMeans was initialized correctly
    mock_constructor.assert_called_once_with(n_clusters=10, random_state=42, n_init='auto')

    # Assert fit_predict was called on the embeddings
    assert mock_instance.fit_predict.call_count == 1

    # Assert the output map is correct based on our mock's return value
    assert len(result) == 50
    assert result['c0'] == 0
    assert result['c1'] == 1
    assert result['c5'] == 0

@pytest.mark.parametrize("num_chunks, expected_clusters", [
    (4, 4),      # For < 5 chunks, n_clusters should be num_chunks
    (5, 5),      # Heuristic minimum is 5
    (99, 5),     # 99 // 20 = 4, so max(5, 4) = 5
    (100, 5),    # 100 // 20 = 5, so max(5, 5) = 5
    (101, 5),    # 101 // 20 = 5, so max(5, 5) = 5
    (199, 9),    # 199 // 20 = 9, so max(5, 9) = 9
    (200, 10),   # 200 // 20 = 10, so max(5, 10) = 10
])
def test_cluster_with_heuristic_n_clusters(mock_kmeans, num_chunks, expected_clusters):
    """Tests the heuristic for determining n_clusters across various chunk counts."""
    mock_constructor, _ = mock_kmeans

    clusterer = Clusterer()  # n_clusters is None, so heuristic should be used
    chunks = create_dummy_chunks(num_chunks)

    clusterer.cluster_chunks(chunks)

    # Assert KMeans was initialized with the correct heuristically-determined n_clusters
    mock_constructor.assert_called_once_with(n_clusters=expected_clusters, random_state=42, n_init='auto')
