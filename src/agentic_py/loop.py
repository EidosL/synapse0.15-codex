import asyncio
from typing import List, Dict, Any, Optional, Callable

from pydantic import BaseModel

from .budget import AGENT_BUDGET, Tier
from .planner import plan_next_step
from .models import ToolResult

from .tools import WebSearchTool, MindMapTool

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

async def run_agentic_insight(ctx: AgenticContext, tools: Dict[str, Any]) -> AgenticContext:
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

    while steps < budget.maxSteps and tool_calls < budget.maxToolCalls:
        transcript_text = "\n".join(ctx.transcript)
        await tools['mind'].update(transcript_text)

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

        result = ToolResult(action=action, content='', ok=True)

        if action == 'web_search':
            hits = await tools['web'].search(message, 5)
            # TODO: Add summarization logic here, similar to the TS implementation.
            bullets = "\n".join([f"• {h['title']}: {h['snippet']}" for h in hits])
            result.content = f"WEB_SUMMARY:\n{bullets}"
            result.citations = [{"url": h['url']} for h in hits]
            tool_calls += 1

        elif action == 'mind_map':
            ans = await tools['mind'].answer(message)
            result.content = f"MINDMAP:\n{ans}"
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
    tools = {
        "web": WebSearchTool(),
        "mind": MindMapTool(),
    }

    ctx = AgenticContext(
        tier=tier,
        topic=topic,
        transcript=[f"INSIGHT: {insight_core}"],
        hooks=hooks or {},
    )

    final_ctx = await run_agentic_insight(ctx, tools)

    return "\n".join(final_ctx.transcript)
