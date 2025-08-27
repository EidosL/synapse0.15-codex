from pydantic import BaseModel
from typing import List, Literal, Optional

# Type definitions mirroring src/agentic/types.ts

ToolKind = Literal['none', 'finalize', 'web_search', 'mind_map', 'continue']

class PlanStep(BaseModel):
    action: ToolKind
    message: str
    expected: str
    stopWhen: Optional[List[str]] = None

class PlanJSON(BaseModel):
    rationale: str
    step: PlanStep

class Citation(BaseModel):
    url: Optional[str] = None
    noteId: Optional[str] = None
    childId: Optional[str] = None
    quote: Optional[str] = None

class ToolResult(BaseModel):
    action: ToolKind
    ok: bool
    content: str
    citations: Optional[List[Citation]] = None

class MindNode(BaseModel):
    id: str
    label: str
    kind: Literal['entity', 'concept', 'claim']

class MindEdge(BaseModel):
    s: str
    t: str
    rel: str

class MindMap(BaseModel):
    nodes: List[MindNode]
    edges: List[MindEdge]
    summaries: List[str]
