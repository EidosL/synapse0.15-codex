from typing import List
from .models import Chunk
from sentence_transformers import SentenceTransformer

class Embedder:
    def __init__(self, model_name: str = 'all-MiniLM-L6-v2'):
        """
        Initializes the embedder with a pre-trained sentence-transformer model.
        """
        # To prevent a warning about thread-local storage.
        # See: https://github.com/huggingface/transformers/issues/18480
        import os
        os.environ["TOKENIZERS_PARALLELISM"] = "false"

        self.model = SentenceTransformer(model_name)

    def embed_chunks(self, chunks: List[Chunk]) -> List[Chunk]:
        """
        Generates embeddings for a list of chunks and adds them to the chunk objects.
        """
        if not chunks:
            return []

        texts_to_embed = [chunk.text for chunk in chunks]
        embeddings = self.model.encode(texts_to_embed, convert_to_tensor=False)

        for i, chunk in enumerate(chunks):
            chunk.embedding = embeddings[i].tolist() # Store as list of floats

        return chunks
