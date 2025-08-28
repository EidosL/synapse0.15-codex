import pytest
from src.eureka_rag.models import Document
from src.eureka_rag.chunker import chunk_document

def test_chunk_document_empty():
    """Tests that an empty document content results in no chunks."""
    doc = Document(id="doc1", title="Test Doc", content="")
    chunks = chunk_document(doc)
    assert len(chunks) == 0

def test_chunk_document_single_paragraph():
    """Tests that a single paragraph document results in a single chunk."""
    content = "This is a single paragraph."
    doc = Document(id="doc1", title="Test Doc", content=content)
    chunks = chunk_document(doc)
    assert len(chunks) == 1
    assert chunks[0].text == "This is a single paragraph."
    assert chunks[0].id == "doc1_chunk_0"
    assert chunks[0].document_id == "doc1"

def test_chunk_document_multiple_paragraphs():
    """Tests splitting of multiple paragraphs based on double newlines."""
    content = "First paragraph.\n\nSecond paragraph."
    doc = Document(id="doc2", title="Test Doc 2", content=content)
    chunks = chunk_document(doc)
    assert len(chunks) == 2
    assert chunks[0].text == "First paragraph."
    assert chunks[1].text == "Second paragraph."
    assert chunks[1].id == "doc2_chunk_1"

def test_chunk_document_with_various_spacings():
    """Tests splitting paragraphs with varied whitespace between them."""
    content = "Para 1\n  \nPara 2\n\n\nPara 3"
    doc = Document(id="doc3", title="Test Doc 3", content=content)
    chunks = chunk_document(doc)
    assert len(chunks) == 3
    assert chunks[0].text == "Para 1"
    assert chunks[1].text == "Para 2"
    assert chunks[2].text == "Para 3"

def test_chunk_document_strips_whitespace():
    """Tests that leading/trailing whitespace from paragraphs is stripped."""
    content = "  \n\n  Leading and trailing whitespace.  \n\n  "
    doc = Document(id="doc4", title="Test Doc 4", content=content)
    chunks = chunk_document(doc)
    assert len(chunks) == 1
    assert chunks[0].text == "Leading and trailing whitespace."

def test_chunk_document_ignores_empty_paragraphs():
    """Tests that paragraphs containing only whitespace are ignored."""
    content = "Hello\n\n \n\nWorld"
    doc = Document(id="doc5", title="Test Doc 5", content=content)
    chunks = chunk_document(doc)
    assert len(chunks) == 2
    assert chunks[0].text == "Hello"
    assert chunks[1].text == "World"
