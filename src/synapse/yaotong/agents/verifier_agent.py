from __future__ import annotations

from typing import Any, Dict, List, Optional

from src.backend.refinement import run_self_evolution, verify_candidates
from src.agentscope_app.telemetry import trace


@trace("yaotong.verifier.self_evolve_and_verify")
async def self_evolve_and_verify(
    insight_text: str,
    hypotheses: List[Dict[str, Any]] | None,
    query: str,
    iterations: int = 2,
    web_enabled: bool = True,
    max_sites: int = 3,
) -> Dict[str, Any]:
    """
    Iteratively self-evolve the insight and verify against web evidence.
    Returns a dict with evolution steps and final verdict.
    """
    history: List[Dict[str, Any]] = []
    current = insight_text or ""

    for step in range(max(1, iterations)):
        evolved = await run_self_evolution(current)
        if evolved and evolved != current:
            current = evolved
        # build candidates: evolved core + hypotheses texts
        cands: List[Dict[str, Any]] = [{"text": current}]
        if hypotheses:
            cands.extend({"text": h.get("statement", "")} for h in hypotheses if h and h.get("statement"))
        verdicts: List[Dict[str, Any]] = []
        if web_enabled:
            verdicts = await verify_candidates(query, cands, max_sites=max_sites)
        history.append({
            "iteration": step + 1,
            "core": current,
            "verdicts": verdicts,
        })
        # If supported verdict for the core appears, we can stop early
        supported = next((v for v in verdicts if v.get("candidate", {}).get("text") == current and v.get("verdict") == "supported"), None)
        if supported:
            break

    final_verdicts = history[-1].get("verdicts", []) if history else []
    supported_any = next((v for v in final_verdicts if v.get("verdict") == "supported"), None)
    final_core = supported_any.get("candidate", {}).get("text") if supported_any else current
    return {
        "final_core": final_core,
        "history": history,
        "final_verdict": supported_any or (final_verdicts[0] if final_verdicts else None),
    }

