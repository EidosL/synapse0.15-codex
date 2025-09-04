from __future__ import annotations

from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.refinement import run_self_evolution, verify_candidates
from src.agentscope_app.telemetry import trace


@trace("synapse.verifier")
async def verify_and_refine(
    top_insight: Dict[str, Any],
    source_note: Dict[str, Any],
    all_notes: List[Dict[str, Any]],
    db: AsyncSession,
) -> Dict[str, Any]:
    """
    Self-evolve top insight, then ground with web verification when available.
    Returns possibly updated top_insight.
    """
    # Self-evolution
    evolved_core = await run_self_evolution(top_insight.get("insightCore", ""))
    if evolved_core and evolved_core != top_insight.get("insightCore"):
        top_insight["insightCore"] = evolved_core
        top_insight["score"] = top_insight.get("score", 0) * 1.1

    # Verification via SERP
    candidates_to_verify = [{"text": h.get("statement", "")} for h in top_insight.get("hypotheses", [])]
    candidates_to_verify.insert(0, {"text": top_insight.get("insightCore", "")})
    query = source_note.get("title", "") or source_note.get("content", "")[:120]
    verdicts = await verify_candidates(query, candidates_to_verify)
    chosen = next((v for v in verdicts if v.get("verdict") == "supported"), verdicts[0] if verdicts else None)
    if chosen:
        top_insight["insightCore"] = chosen["candidate"]["text"]
        top_insight["verification"] = chosen
        if chosen.get("verdict") == "supported":
            top_insight["score"] = max(top_insight.get("score", 0), 0.85)
    return top_insight
