from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class PipelineInput(BaseModel):
    """
    Mirrors the existing backend_pipeline.PipelineInput to keep compatibility.
    """
    source_note_id: str
    notes: List[Dict[str, Any]]


class EvidenceRef(BaseModel):
    noteId: str
    childId: Optional[str] = None
    quote: str


class InsightPayload(BaseModel):
    mode: str
    reframedProblem: str
    insightCore: str
    selectedHypothesisName: str
    hypotheses: List[Dict[str, Any]]
    eurekaMarkers: Dict[str, float]
    bayesianSurprise: float
    evidenceRefs: List[EvidenceRef]
    test: str
    risks: List[str]
    # Optional enrichments
    score: Optional[float] = None
    confidence: Optional[float] = None
    agenticTranscript: Optional[Any] = None
    verification: Optional[Any] = None

