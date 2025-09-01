# synapse/yaotong/tools/local_fusion.py
from typing import Dict, Any, List
from ..models.fusion import Hypothesis, FusionInsight
from .insight_generator import generate_insight
import uuid

async def fusion_compose_tool(hypotheses: List[Dict[str,Any]], role_order=("Base","Tonic","Catalyst")) -> Dict[str, Any]:
    """
    Input: {"hypotheses": [Hypothesis-like dicts]}
    Output: {"pills": [FusionInsight-like dicts]}
    """
    hyps = [Hypothesis(**h) for h in hypotheses]
    # TODO: real selection (Pareto over support/novelty/coherence)
    selected = sorted(hyps, key=lambda h: (h.supportScore, h.coherenceScore, h.noveltyScore), reverse=True)[:3]
    pills: List[FusionInsight] = []
    for role, h in zip(role_order, selected):
        insight = await generate_insight([h.statement], f"Compose insight for {role}")
        insight.id = str(uuid.uuid4())
        insight.role = role
        insight.hypotheses = [h.id]
        insight.evidenceRefs = h.facets
        insight.confidence = min(0.99, 0.5 + 0.5*h.supportScore)
        pills.append(insight)
    return {"pills": [p.model_dump() for p in pills]}
