import asyncio
from typing import List, Dict, Any, Optional, Callable

from pydantic import BaseModel

from .budget import AGENT_BUDGET, Tier
from .planner import plan_next_step
from .models import ToolResult

from .tools.base import Tool
from .tools.web_search import WebSearchTool
from .tools.mind_map import MindMapTool

# --- Agentic Context and Loop ---

class AgenticContext(BaseModel):
    """
    Holds the state and configuration for a single agentic run.
    """
    tier: Tier
    topic: str
    transcript: List[str]
    mindHints: List[str] = []
    hooks: Dict[str, Callable] = {}

async def run_agentic_insight(ctx: AgenticContext, tools: List[Tool]) -> AgenticContext:
    """
    The main execution loop for the agent.
    It repeatedly plans, acts, and updates the transcript within a set budget.
    """
    budget = AGENT_BUDGET[ctx.tier]
    if budget.maxSteps == 0:
        return ctx

    steps = 0
    tool_calls = 0
    log = ctx.hooks.get('onLog', print)

    # Find the mind map tool, as it's a special case that needs to be updated each loop.
    mind_map_tool = next((t for t in tools if isinstance(t, MindMapTool)), None)

    while steps < budget.maxSteps and tool_calls < budget.maxToolCalls:
        transcript_text = "\n".join(ctx.transcript)
        if mind_map_tool:
            await mind_map_tool.update(transcript_text)

        plan = await plan_next_step(transcript_text, ctx.mindHints, budget.tempPlan)
        if not plan:
            log("Planner failed to return a plan. Halting.")
            break

        action = plan.step.action
        message = plan.step.message
        expected = plan.step.expected
        log(f"Plan: {action} — {message}")

        if action in ['none', 'finalize']:
            ctx.transcript.append(f"FINALIZE: {plan.rationale}")
            break

        if action == 'continue':
            ctx.transcript.append(f"CONTINUE: {message}")
            steps += 1
            continue

        tool_to_run = next((t for t in tools if t.name == action), None)

        if not tool_to_run:
            ctx.transcript.append(f"ERROR: Tool '{action}' not found.")
            steps += 1
            continue

        result = await tool_to_run.execute(plan.step)
        tool_calls += 1

        on_tool_hook = ctx.hooks.get('onTool')
        if on_tool_hook:
            on_tool_hook(result)

        ctx.transcript.append(f"TOOL[{action}] expected({expected})\n{result.content[:1200]}")
        steps += 1

    return ctx

async def maybe_auto_deepen(
    tier: Tier,
    topic: str,
    insight_core: str,
    evidence_texts: List[str],
    hooks: Optional[Dict[str, Callable]] = None
) -> Optional[str]:
    """
    Entry point for the agentic refinement process.
    Acts as a gatekeeper and sets up the initial context.
    """
    if tier != 'pro':
        return None

    # Gate: only deepen if evidence is thin
    if sum(len(text) for text in evidence_texts) >= 1200:
        return None

    # Instantiate the real tools
    tools = [
        WebSearchTool(),
        MindMapTool(),
    ]

    ctx = AgenticContext(
        tier=tier,
        topic=topic,
        transcript=[f"INSIGHT: {insight_core}"],
        hooks=hooks or {},
    )

    final_ctx = await run_agentic_insight(ctx, tools)

    return "\n".join(final_ctx.transcript)
