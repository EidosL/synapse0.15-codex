from __future__ import annotations

from typing import Any, Dict, List
from pydantic import BaseModel, Field

from .prescriber import Prescription


class PlanStep(BaseModel):
    name: str
    args: Dict[str, Any] = Field(default_factory=dict)


class Plan(BaseModel):
    steps: List[PlanStep]


async def build_plan(p: Prescription) -> Plan:
    """Translate prescription into concrete steps.

    Minimal executable plan:
    1) refine_materials (template-driven distillation)
    2) retrieve (hybrid/lexical)
    3) generate_insights (LLM or local fusion)
    4) verify (if enabled)
    """
    steps: List[PlanStep] = [
        PlanStep(name="refine_materials", args={"enable_templates": True}),
        PlanStep(name="retrieve", args={"strategy": p.retrieval.get("strategy"), "top_k": p.retrieval.get("top_k", 10)}),
        PlanStep(name="generate_insights", args={"llm": p.toggles.get("llm", True)}),
    ]
    if p.verification.get("enabled"):
        steps.append(PlanStep(name="verify", args={"max_sites": p.verification.get("max_sites", 3)}))

    return Plan(steps=steps)

