from typing import List
from .models import Chunk
from src.util.genai_compat import embed_texts_sync


class Embedder:
    def __init__(self, model_name: str = 'text-embedding-004'):
        """
        Cloud-based embedder using Google embeddings.
        """
        self.model_name = model_name

    def embed_chunks(self, chunks: List[Chunk]) -> List[Chunk]:
        """
        Generates embeddings for a list of chunks via Google Embeddings API.
        """
        if not chunks:
            return []

        texts_to_embed = [chunk.text for chunk in chunks]

        embeddings = embed_texts_sync(self.model_name, texts_to_embed)

        for i, chunk in enumerate(chunks):
            chunk.embedding = list(embeddings[i]) if i < len(embeddings) else []

        return chunks
