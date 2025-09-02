"""
Insight generation module for YaoTong Agent.

This provides a class-based API to compose insights from a set of notes,
honoring the Recipe configuration. Initially, it reuses the existing
local fusion tool to keep behavior consistent, and can later be extended
to call LLMs for richer synthesis.
"""
from __future__ import annotations
from typing import List, Set
import uuid
import re

from .models.note import Note
from .models.recipe import Recipe
from .models.fusion import FusionInsight
from .tools.local_fusion import fusion_compose_tool
from ..config.llm import route_llm_call  # centralized routing


class InsightGenerator:
    """Generate insights from notes according to a Recipe.

    Methods here intentionally keep a minimal surface to ease future
    replacement with different generation strategies (e.g., LLM-backed).
    """

    def __init__(self) -> None:
        # placeholder for future dependencies (e.g., LLM client)
        pass

    async def generate(self, notes: List[Note], recipe: Recipe) -> List[FusionInsight]:
        """Compose insights from notes.

        Strategy:
        1) If an LLM model is configured via Recipe, attempt single-pill
           composition with the desired style and optional citations.
        2) Fallback to local fusion compose tool using naive hypotheses.

        In later iterations we will:
        - extract facets from notes
        - score hypotheses (support/novelty/coherence)
        - call LLMs to compose rationale and uncertainty
        """
        # 1) Try LLM composition if model provided
        model = getattr(recipe, "model", None)
        if model:
            try:
                style = getattr(recipe, "summary_style", "detailed")
                citing = bool(getattr(recipe, "citing", True))
                note_snippets = []
                for n in notes[: max(1, recipe.notes_limit)]:
                    preview = n.get_preview(400)
                    note_snippets.append(f"- [{n.id}] {n.title}: {preview}")
                style_hint = {
                    "concise": "Be crisp and to the point (3-5 sentences).",
                    "detailed": "Provide a structured paragraph with key reasoning and implications.",
                    "analytical": "Provide a short outline: claim → mechanism → evidence → implications.",
                }.get(style, "Provide a structured paragraph with key reasoning and implications.")
                prompt = (
                    "You are an expert research synthesizer.\n"
                    f"Goal: Compose a {style} insight that integrates the following notes.\n"
                    f"Style guidance: {style_hint}\n"
                    "Avoid hallucinations; only use provided content.\n"
                    "Notes:\n" + "\n".join(note_snippets) + "\n\n"
                )
                if citing:
                    prompt += (
                        "If you quote or rely on a note, include inline tags like [note:ID].\n"
                    )
                prompt += (
                    "Return only the synthesized insight text without metadata."
                )
                # Centralized routing via task name; backend config picks model
                resp = await route_llm_call('generateInsight', [
                    {"role": "system", "content": "Return only the synthesized insight text without metadata."},
                    {"role": "user", "content": prompt},
                ])
                text = str(resp.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()
                if text:
                    # Extract inline citations of the form [note:ID]
                    cited: Set[str] = set(re.findall(r"\[note:([^\]\s]+)\]", text))
                    # Limit refs to the notes we actually used
                    allowed_ids = {n.id for n in notes}
                    refs = [cid for cid in cited if cid in allowed_ids]
                    if not refs:
                        refs = [n.id for n in notes[: max(1, recipe.notes_limit)]]
                    pill = FusionInsight(
                        id=str(uuid.uuid4()),
                        role="Base",
                        core=text,
                        rationale=f"Composed from {min(len(notes), recipe.notes_limit)} notes in {style} style",
                        hypotheses=[],
                        evidenceRefs=refs,
                        confidence=0.7,
                    )
                    return [pill]
            except Exception:
                # Fall back to local fusion compose when LLM is unavailable or fails
                pass

        # 2) Fallback: local fusion tool with naive hypotheses
        hypotheses = []
        for idx, n in enumerate(notes):
            hypotheses.append({
                "id": f"h{idx+1}",
                "statement": n.title or n.get_preview(120),
                "facets": [n.id],
                "conflicts": [],
                "supportScore": 0.5,
                "noveltyScore": 0.5,
                "coherenceScore": 0.5,
            })
        out = await fusion_compose_tool(hypotheses)
        pills = out.get("pills", [])
        return [FusionInsight(**p) for p in pills]
