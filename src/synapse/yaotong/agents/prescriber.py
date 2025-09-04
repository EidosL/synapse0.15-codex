from __future__ import annotations

from typing import Any, Dict, Optional
from pydantic import BaseModel, Field

from ...yaotong.journal import Journal
from src.agentscope_app.telemetry import trace
from src.synapse.config.llm import llm_structured


class Budget(BaseModel):
    usd: float = 0.0
    tokens: int = 0
    time_sec: int = 0


class Prescription(BaseModel):
    goal: str
    mode: str = "fusion"  # pairwise | fusion
    notes_limit: int = 5
    explore_depth: int = 1
    use_graph: bool = False
    toggles: Dict[str, bool] = Field(default_factory=lambda: {"llm": True, "web": False})
    budgets: Budget = Field(default_factory=Budget)
    retrieval: Dict[str, Any] = Field(default_factory=lambda: {"strategy": "hybrid", "top_k": 10})
    verification: Dict[str, Any] = Field(default_factory=lambda: {"enabled": True, "max_sites": 3})
    refining: Dict[str, Any] = Field(default_factory=lambda: {"enable_templates": True})


@trace("yaotong.prescribe")
async def prescribe(
    goal: str,
    project_capabilities: Optional[Dict[str, Any]] = None,
    user_budgets: Optional[Dict[str, Any]] = None,
    toggles: Optional[Dict[str, bool]] = None,
    project_doc: Optional[str] = None,
    journal: Optional[Journal] = None,
) -> Prescription:
    """LLM-powered prescription planner with graceful fallback.

    If an AgentScope ChatModel is configured, request a structured
    `Prescription` based on the goal, project capabilities & budgets.
    Otherwise, fall back to deterministic defaults.
    """
    caps = project_capabilities or {}
    budget = user_budgets or {}
    tgl = toggles or {}
    try:
        sys = (
            "You are a prescriber agent for a multi-agent research app. "
            "Given the user goal, project capabilities and budgets, propose a practical Prescription."
        )
        user = (
            f"Goal: {goal}\n\n"
            f"Capabilities: {caps}\nBudgets: {budget}\nToggles: {tgl}\n\n"
            f"Project Doc (optional):\n{project_doc or ''}"
        )
        p = await llm_structured("prescribe", messages=[
            {"role": "system", "content": sys},
            {"role": "user", "content": user},
        ], structured_model=Prescription, options={"temperature": 0.2})
        if journal:
            journal.add("Prescriber (LLM)", str(p.model_dump()))
        return p
    except Exception:
        if journal:
            journal.add("Prescriber (LLM)", "Invalid structured output, using fallback.")

    # Fallback deterministic path
    faiss_ok = bool(caps.get("faiss", True))
    serp_ok = bool(caps.get("serp", False))
    llm_ok = bool(caps.get("llm", True))
    b = Budget(**budget)
    tg = {"llm": True, "web": False}
    tg.update(tgl)
    retrieval = {"strategy": "hybrid" if faiss_ok else "lexical", "top_k": 10}
    verification = {"enabled": bool(serp_ok and tg.get("web", True)), "max_sites": 3, "iterations": 1}
    allow_llm = llm_ok and tg.get("llm", True) and (b.usd > 0 or b.tokens > 0)
    p = Prescription(
        goal=goal,
        retrieval=retrieval,
        verification=verification,
        toggles={"llm": allow_llm, "web": verification["enabled"]},
        budgets=b,
    )
    if journal:
        journal.add("Prescriber (fallback)", str(p.model_dump()))
    return p
