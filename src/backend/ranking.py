import json
from typing import List, Dict, Any, Optional

from src.synapse.config.llm import llm_json

COUNTER_SCHEMA = {
    "type": "object",
    "properties": {
        "counterEvidence": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "noteId": {"type": "string"},
                    "childId": {"type": "string"},
                    "quote": {"type": "string"},
                    "rationale": {"type": "string"},
                },
                "required": ["noteId", "childId", "quote"],
            },
        },
        "weakness": {"type": "string"},
        "severity": {"type": "number"},
    },
    "required": ["counterEvidence", "weakness", "severity"],
}

async def counter_insight_check(
    insight_core: str, evidence: List[Dict[str, str]]
) -> Optional[Dict[str, Any]]:
    """
    Adversarially checks an insight against its evidence to find contradictions.
    """
    if not insight_core:
        return None

    bullets = "\n".join([
        f"[{e.get('noteId','')}::{e.get('childId','')}] {e.get('text') or e.get('quote') or ''}"
        for e in (evidence or [])
    ])
    prompt = f"""You are an adversarial checker. Given an INSIGHT and its EVIDENCE snippets, return ONLY a JSON object with fields:
counterEvidence[] (each with noteId, childId, quote, rationale), weakness (string), severity (0..1).

INSIGHT:\n{insight_core}\n\nEVIDENCE:\n{bullets}
"""
    try:
        obj = await llm_json('counterInsight', prompt, temperature=0.1)
        # Basic validation
        if isinstance(obj, dict) and 'counterEvidence' in obj:
            return obj
    except Exception:
        pass
    return None


async def rank_insights(insights: List[Dict[str, Any]], evidence_map: Dict[str, List[Dict[str, str]]]) -> List[Dict[str, Any]]:
    """
    Ranks insights using a sophisticated scoring model.
    """
    import math

    scored_insights = []
    for i, insight in enumerate(insights):
        # 1. Get signals from the insight payload
        eureka_markers = insight.get("eurekaMarkers", {})
        conviction = eureka_markers.get("conviction", 0)
        fluency = eureka_markers.get("fluency", 0)
        surprise = insight.get("bayesianSurprise", 0)

        # 2. Calculate diversity
        evidence_refs = insight.get("evidenceRefs", [])
        # The insight is generated from a pair of notes, so we need to get the evidence for that pair.
        # This is a bit tricky because the insight doesn't directly link to the candidate note id.
        # I will assume the insight has a temporary id that I can use to get the evidence.
        # This part of the logic might need to be adjusted once I integrate it with the main pipeline.
        # For now, I'll assume a simple diversity score.
        # A better approach would be to pass the evidence used for each insight into this function.
        # I will refactor this later if needed.
        # Let's assume for now that the insight object will be enriched with the oldNoteId.
        # This is what the TS implementation does.

        unique_note_ids = {ref["noteId"] for ref in evidence_refs}
        diversity = len(unique_note_ids)

        # 3. Perform counter-insight check
        insight_core = insight.get("insightCore", "")
        # The evidence map needs to be passed in. The key should be something that identifies the insight.
        # Let's use the index for now.
        evidence = evidence_map.get(str(i), [])
        ctr = await counter_insight_check(insight_core, evidence)
        penalty = 0
        if ctr and ctr.get("severity"):
            # The penalty is scaled.
            penalty = 0.25 * min(1, ctr.get("severity", 0))

        # 4. Calculate final score
        # Formula from ai.ts: (0.40 * conviction) + (0.25 * fluency) + (0.15 * surprise) + (0.10 * Math.tanh(diversity/6)) - penalty
        score = (0.40 * conviction) + \
                (0.25 * fluency) + \
                (0.15 * surprise) + \
                (0.10 * math.tanh(diversity / 6.0)) - \
                penalty

        insight["score"] = score
        scored_insights.append(insight)

    # 5. Sort by score
    scored_insights.sort(key=lambda x: x.get("score", 0), reverse=True)
    return scored_insights
