import type { ToolResult } from './types';
import { planNextStep } from './planner';
import { clampTranscript } from './contextPolicy';
import { AGENT_BUDGET, type Tier } from './budget';
import type { Tool } from './tools/tool';
import type { MindMapTool } from './tools/mindMapTool';

export type AgenticContext = {
  tier: Tier; topic: string;
  transcript: string[];           // append-only reasoning turns
  mindHints: string[];
  hooks?: { onTool?: (r:ToolResult)=>void; onLog?: (s:string)=>void };
};

/**
 * Runs the Insight Generator agent loop.
 *
 * This agent's purpose is to take a single topic and explore it to uncover new
 * information and insights. It operates in an autonomous loop, using a set of
 * tools to build a "transcript" of its findings.
 *
 * The agent follows these steps:
 * 1.  **Planning**: Given a topic and a transcript of previous findings, the agent
 *     uses a planner (`src/agentic/planner.ts`) to decide on the next action.
 * 2.  **Tool Use**: The agent has access to a pluggable set of tools.
 * 3.  **Transcript**: The agent appends its actions and the results from its tools
 *     to a running transcript. This transcript serves as the agent's "short-term
 *     memory" and context for future planning steps.
 * 4.  **Budgeting**: The agent operates within a budget (`src/agentic/budget.ts`)
 *     that limits the number of steps and tool calls it can make in a single run.
 *
 * @param ctx The context for the agent, including the topic, transcript, and tier.
 * @param tools A list of tools available to the agent.
 * @returns The final context after the agent has finished its run.
 */
export async function runAgenticInsight(
  ctx: AgenticContext,
  tools: Tool[]
){
  const budget = AGENT_BUDGET[ctx.tier];
  if (budget.maxSteps === 0) return ctx;

  let steps = 0, toolCalls = 0;
  const log = (s:string)=> ctx.hooks?.onLog?.(s);

  // Find the mind map tool, as it's a special case that needs to be updated each loop.
  const mindMapTool = tools.find(t => t.name === 'mind_map') as MindMapTool | undefined;

  while (steps < budget.maxSteps && toolCalls < budget.maxToolCalls) {
    ctx.transcript = clampTranscript(ctx.transcript, budget.contextCapChars);
    const transcriptText = ctx.transcript.join('\n');
    if (mindMapTool) {
      await mindMapTool.update(transcriptText);
    }

    const plan = await planNextStep(transcriptText, ctx.mindHints, budget.tempPlan);
    if (!plan) break;
    const { action, message, expected } = plan.step;
    log?.(`Plan: ${action} — ${message}`);

    if (action === 'none' || action === 'finalize') {
      ctx.transcript.push(`FINALIZE: ${plan.rationale}`);
      break;
    }

    if (action === 'continue') {
        ctx.transcript.push(`CONTINUE: ${message}`);
        steps++;
        continue;
    }

    const tool = tools.find(t => t.name === action);
    if (!tool) {
      ctx.transcript.push(`ERROR: Tool "${action}" not found.`);
      steps++;
      continue;
    }

    const result = await tool.execute(plan.step);
    toolCalls++;

    ctx.hooks?.onTool?.(result);
    ctx.transcript.push(`TOOL[${action}] expected(${expected})\n${result.content.slice(0, 1200)}`);
    steps++;
  }

  return ctx;
}
