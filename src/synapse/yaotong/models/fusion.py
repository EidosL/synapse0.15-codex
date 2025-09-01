# synapse/yaotong/models/fusion.py
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Literal, Optional, Tuple

FacetKind = Literal["definition","claim","evidence","mechanism","counterpoint","open_question"]

class Ingredient(BaseModel):
    id: str
    source: Literal["kb","web","user"]
    text: str
    meta: dict = Field(default_factory=dict)  # note_id/url/span, etc.

class Facet(BaseModel):
    id: str
    kind: FacetKind
    content: str
    supports: List[str] = []        # Ingredient ids
    score: float = 0.0              # extraction confidence

class Hypothesis(BaseModel):
    id: str
    statement: str
    facets: List[str]
    conflicts: List[str] = []
    supportScore: float = 0.0
    noveltyScore: float = 0.0
    coherenceScore: float = 0.0

class FusionInsight(BaseModel):
    id: str
    role: Literal["Base","Tonic","Catalyst"]
    core: str
    rationale: str
    hypotheses: List[str]
    evidenceRefs: List[str]
    confidence: float
    uncertainty: List[str] = []
    lineage: dict = Field(default_factory=dict)  # recipeId, furnaceCfg, versions
