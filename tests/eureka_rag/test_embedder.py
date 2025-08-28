import pytest
from unittest.mock import MagicMock, patch
from src.eureka_rag.embedder import Embedder
from src.eureka_rag.models import Chunk
import numpy as np
import os

@pytest.fixture
def mock_sentence_transformer(mocker):
    """Mocks the SentenceTransformer class for all tests in this file."""
    mock_model = MagicMock()
    # Configure the mock 'encode' method to return a specific numpy array
    mock_model.encode.return_value = np.array([[0.1, 0.2], [0.3, 0.4]])

    # Patch the SentenceTransformer constructor to return our mock_model
    mock_constructor = mocker.patch('src.eureka_rag.embedder.SentenceTransformer', return_value=mock_model)

    return mock_constructor, mock_model

def test_embedder_initialization(mock_sentence_transformer, mocker):
    """Tests that the Embedder initializes the SentenceTransformer with the correct model."""
    # We need to prevent the os.environ call from actually modifying the environment
    mocker.patch.dict(os.environ, {}, clear=True)

    mock_constructor, _ = mock_sentence_transformer

    # Initialize the embedder with a specific model name
    Embedder(model_name='test-model')

    # Assert that SentenceTransformer was called with 'test-model'
    mock_constructor.assert_called_once_with('test-model')

def test_embed_chunks_empty_list(mock_sentence_transformer):
    """Tests that embed_chunks returns an empty list when given no chunks."""
    embedder = Embedder()
    result = embedder.embed_chunks([])
    assert result == []

def test_embed_chunks_with_data(mock_sentence_transformer):
    """Tests that embed_chunks correctly adds embeddings to chunks."""
    mock_constructor, mock_model = mock_sentence_transformer

    embedder = Embedder()

    chunks = [
        Chunk(id="c1", document_id="d1", text="first chunk"),
        Chunk(id="c2", document_id="d1", text="second chunk")
    ]

    # The expected embeddings from our mock
    expected_embeddings = [[0.1, 0.2], [0.3, 0.4]]

    # Act
    result_chunks = embedder.embed_chunks(chunks)

    # Assert
    # Check that the model's encode method was called correctly
    mock_model.encode.assert_called_once_with(["first chunk", "second chunk"], convert_to_tensor=False)

    # Check that the embeddings were added to the chunks
    assert len(result_chunks) == 2
    assert result_chunks[0].embedding == expected_embeddings[0]
    assert result_chunks[1].embedding == expected_embeddings[1]

    # Check that the original chunk objects are modified (the function works by side-effect)
    assert chunks[0].embedding == expected_embeddings[0]

def test_tokenizer_parallelism_is_set(mocker):
    """Tests that the TOKENIZERS_PARALLELISM environment variable is set on init."""
    # We need to patch SentenceTransformer here as well to avoid the real import
    mocker.patch('src.eureka_rag.embedder.SentenceTransformer')

    # Use patch.dict to check the environment variable
    with patch.dict(os.environ, {}, clear=True):
        Embedder()
        assert os.environ.get("TOKENIZERS_PARALLELISM") == "false"
