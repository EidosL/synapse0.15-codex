# synapse/yaotong/tools/insight_generator.py
from __future__ import annotations
import json
import uuid
from typing import List

from ..models.fusion import FusionInsight
from util.genai_compat import generate_text

async def generate_insight(notes: List[str], instruction: str) -> FusionInsight:
    """Generate a FusionInsight from notes and an instruction using an LLM."""
    prompt_notes = "\n".join(f"- {n}" for n in notes)
    prompt = (
        "You are an analytical assistant. Given these notes:\n"
        f"{prompt_notes}\n\n"
        f"Instruction: {instruction}.\n"
        "Respond in JSON with keys: core, rationale, uncertainty (a list of strings)."
    )
    try:
        resp = await generate_text("gemini-1.5-flash", prompt)
        data = json.loads(resp)
    except Exception:
        data = {"core": "", "rationale": "", "uncertainty": []}
    return FusionInsight(
        id=str(uuid.uuid4()),
        role="Base",
        core=data.get("core", ""),
        rationale=data.get("rationale", ""),
        hypotheses=[],
        evidenceRefs=list(notes),
        confidence=0.0,
        uncertainty=data.get("uncertainty", []),
    )
