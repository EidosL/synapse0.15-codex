from __future__ import annotations

import asyncio
from typing import Dict, Any, List, Optional, Tuple

from src.synapse.config.llm import llm_json
from src.backend.ranking import rank_insights
from src.agentscope_app.telemetry import trace


INSIGHT_SCHEMA = {
    "type": "object",
    "properties": {
        "mode": {"type": "string"},
        "reframedProblem": {"type": "string"},
        "insightCore": {"type": "string"},
        "selectedHypothesisName": {"type": "string"},
        "hypotheses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "statement": {"type": "string"},
                    "predictedEvidence": {"type": "array", "items": {"type": "string"}},
                    "disconfirmers": {"type": "array", "items": {"type": "string"}},
                    "prior": {"type": "number"},
                    "posterior": {"type": "number"},
                },
                "required": [
                    "name",
                    "statement",
                    "predictedEvidence",
                    "disconfirmers",
                    "prior",
                    "posterior",
                ],
            },
        },
        "eurekaMarkers": {
            "type": "object",
            "properties": {
                "suddennessProxy": {"type": "number"},
                "fluency": {"type": "number"},
                "conviction": {"type": "number"},
                "positiveAffect": {"type": "number"},
            },
            "required": [
                "suddennessProxy",
                "fluency",
                "conviction",
                "positiveAffect",
            ],
        },
        "bayesianSurprise": {"type": "number"},
        "evidenceRefs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "noteId": {"type": "string"},
                    "childId": {"type": "string"},
                    "quote": {"type": "string"},
                },
                "required": ["noteId", "childId", "quote"],
            },
        },
        "test": {"type": "string"},
        "risks": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "mode",
        "reframedProblem",
        "insightCore",
        "selectedHypothesisName",
        "hypotheses",
        "eurekaMarkers",
        "bayesianSurprise",
        "evidenceRefs",
        "test",
        "risks",
    ],
}


@trace("synapse.fusion.generate_insight")
async def _generate_insight(evidence_chunks: List[Dict[str, str]]) -> Optional[Dict[str, Any]]:
    bullets = "\n".join(
        [f"[{c['noteId']}::{c.get('childId', '')}] {c['text']}" for c in evidence_chunks]
    )
    instr = (
        "You are an Insight Engine. Using ONLY the provided evidence, return a single JSON object with fields: "
        "mode,reframedProblem,insightCore,selectedHypothesisName,hypotheses[{name,statement,predictedEvidence,disconfirmers,prior,posterior}],"
        "eurekaMarkers{suddennessProxy,fluency,conviction,positiveAffect},bayesianSurprise,evidenceRefs[{noteId,childId,quote}],test,risks[]."
    )
    prompt = f"{instr}\nEVIDENCE:\n{bullets}"
    try:
        data = await llm_json("generateInsight", prompt, temperature=0.7)
        return data
    except Exception as e:
        print(f"Fusion generation error: {e}")
        return None


@trace("synapse.fusion_crucible")
async def fuse_and_rank(
    source_note: Dict[str, Any],
    candidate_notes: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Produce insights using pairwise evidence and rank them; return top 3."""
    tasks: List[Tuple[asyncio.Task, str, List[Dict[str, str]]]] = []
    for cand in candidate_notes:
        source_chunks = [
            {"noteId": source_note["id"], "text": p}
            for p in source_note.get("content", "").split("\n\n")[:2]
            if p.strip()
        ]
        cand_chunks = [
            {"noteId": cand["id"], "text": p}
            for p in cand.get("content", "").split("\n\n")[:2]
            if p.strip()
        ]
        ev = source_chunks + cand_chunks
        tasks.append((asyncio.create_task(_generate_insight(ev)), cand["id"], ev))

    results = await asyncio.gather(*[t[0] for t in tasks])
    insights_with_ev: List[Dict[str, Any]] = []
    for i, ins in enumerate(results):
        if ins and ins.get("mode") != "none":
            _, cand_id, ev = tasks[i]
            ins["oldNoteId"] = cand_id
            insights_with_ev.append({"insight": ins, "evidence": ev})

    if not insights_with_ev:
        return []

    final_insights = [item["insight"] for item in insights_with_ev]
    ev_map = {str(i): item["evidence"] for i, item in enumerate(insights_with_ev)}

    ranked = await rank_insights(final_insights, ev_map)
    return ranked[:3]
