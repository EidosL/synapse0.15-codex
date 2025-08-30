from typing import List
from eureka_rag.models import Document, Chunk
import re

def chunk_document(document: Document) -> List[Chunk]:
    """
    Splits a document into chunks based on paragraphs.
    A paragraph is considered to be a block of text separated by one or more empty lines.
    """
    # Split by one or more newlines, which typically separate paragraphs
    paragraphs = re.split(r'\\n\\s*\\n', document.content)

    chunks = []
    for i, para in enumerate(paragraphs):
        # Filter out empty or very short paragraphs
        if para.strip():
            chunk_id = f"{document.id}_chunk_{i}"
            chunks.append(Chunk(id=chunk_id, document_id=document.id, text=para.strip()))

    return chunks
