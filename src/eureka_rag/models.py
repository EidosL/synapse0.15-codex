from pydantic import BaseModel
from typing import List, Dict, Optional

class Document(BaseModel):
    """Represents a single note or document provided by the frontend."""
    id: str
    title: str
    content: str

class Chunk(BaseModel):
    """Represents a piece of text from a document."""
    id: str
    document_id: str
    text: str
    embedding: Optional[List[float]] = None

class ClusterSummary(BaseModel):
    """Represents the summary of a single cluster."""
    cluster_id: int
    summary: str

class ClusteringResult(BaseModel):
    """The response model for the clustering and summarization endpoint."""
    chunk_to_cluster_map: Dict[str, int]  # Maps chunk_id to cluster_id
    cluster_summaries: List[ClusterSummary]

class ChunkInput(BaseModel):
    """Represents a single chunk of text sent from the frontend."""
    id: str
    document_id: str
    text: str

class ClusterChunksRequest(BaseModel):
    """The request model for clustering pre-chunked text."""
    chunks: List[ChunkInput]

class ClusterRequest(BaseModel):
    """The request model for the clustering endpoint, containing all notes."""
    notes: List[Document]
