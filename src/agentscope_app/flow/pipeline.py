from __future__ import annotations

from typing import Any, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession

from src.jobs import Phase, Insight, JobResult
from src.progress import ProgressReporter

from src.agentscope_app.schemas import PipelineInput
from src.agentscope_app.telemetry import trace
from src.agentscope_app.agents.candidate_miner import mine_candidates
from src.agentscope_app.agents.fusion_crucible import fuse_and_rank
from src.agentscope_app.agents.verifier import verify_and_refine


@trace("synapse.pipeline")
async def run_full_insight_pipeline(
    inp: PipelineInput,
    progress: ProgressReporter,
    db: AsyncSession,
) -> JobResult:
    # 1) Candidate selection
    await progress.update(Phase.candidate_selection, 5)
    source_note = next((n for n in inp.notes if n.get("id") == inp.source_note_id), None)
    if not source_note:
        raise ValueError("Source note not found.")

    candidates = await mine_candidates(source_note, inp.notes, db, top_k=10)
    if not candidates:
        raise ValueError("No candidates discovered for fusion.")
    await progress.update(
        Phase.candidate_selection, 30, metrics_delta={"notes_considered": len(candidates)}
    )

    # 2) Initial synthesis/fusion
    fused = await fuse_and_rank(source_note, candidates)
    if not fused:
        raise ValueError("Synthesis produced no valid insights.")

    partial = [
        Insight(
            insight_id=f"temp-{i}",
            title=d.get("insightCore", "Untitled Insight"),
            score=d.get("score", 0),
        )
        for i, d in enumerate(fused)
    ]
    await progress.update(Phase.initial_synthesis, 50, partial=partial)

    # 3) Multi-hop / bridging (reuse top-1 heuristic via verification agent later)
    await progress.update(Phase.multi_hop, 60)

    # 4) Agentic refinement + verification
    top = fused[0]
    top = await verify_and_refine(top, source_note, inp.notes, db)
    await progress.update(Phase.agent_refinement, 80)

    # 5) Finalize
    final = [
        Insight(
            insight_id=f"final-{i}",
            title=d.get("insightCore", "Untitled Insight"),
            score=d.get("score", 0),
            snippet=d.get("reframedProblem"),
            agenticTranscript=d.get("agenticTranscript"),
            verification=d.get("verification"),
        )
        for i, d in enumerate(fused)
    ]
    await progress.update(Phase.finalizing, 100)
    return JobResult(version="v2", insights=final)
