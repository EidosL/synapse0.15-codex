import type { WebSearch, MindMapTool, ToolResult } from './types';
import { planNextStep } from './planner';
import { AGENT_BUDGET, type Tier } from './budget';
import { ai, MODEL_NAME } from '../lib/ai';

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
 * 2.  **Tool Use**: The agent has access to two main tools:
 *     - `web_search`: It can search the web to find new information about the topic.
 *     - `mind_map`: It can interact with a mind map to store and retrieve information.
 * 3.  **Transcript**: The agent appends its actions and the results from its tools
 *     to a running transcript. This transcript serves as the agent's "short-term
 *     memory" and context for future planning steps.
 * 4.  **Budgeting**: The agent operates within a budget (`src/agentic/budget.ts`)
 *     that limits the number of steps and tool calls it can make in a single run.
 *
 * @param ctx The context for the agent, including the topic, transcript, and tier.
 * @param tools The tools available to the agent, such as web search and mind map.
 * @returns The final context after the agent has finished its run.
 */
export async function runAgenticInsight(
  ctx: AgenticContext,
  tools: { web: WebSearch; mind: MindMapTool }
){
  const budget = AGENT_BUDGET[ctx.tier];
  if (budget.maxSteps === 0) return ctx;

  let steps = 0, toolCalls = 0;
  const log = (s:string)=> ctx.hooks?.onLog?.(s);

  while (steps < budget.maxSteps && toolCalls < budget.maxToolCalls) {
    const transcriptText = ctx.transcript.join('\n');
    await tools.mind.update(transcriptText);

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

    let result: ToolResult = { action, content: '', ok: true };

    if (action === 'web_search') {
      const hits = await tools.web.search(message, 5);
      const bullets = hits.map(h => `• ${h.title}: ${h.snippet}`).join('\n');
      // Summarize to keep context lean using streaming
      let summary = '';
      if (ai) {
        const stream = await ai.models.generateContentStream({
          model: MODEL_NAME,
          contents: `Summarize key facts useful for: "${expected}". Use only these bullets, no new claims.\n${bullets}`
        });
        for await (const chunk of stream) {
          const text = chunk.text ?? '';
          summary += text;
          log(text);
        }
      } else {
        summary = bullets;
      }
      result.content = `WEB_SUMMARY:\n${summary || bullets}`;
      result.citations = hits.map(h => ({ url: h.url }));
      toolCalls++;
    }

    if (action === 'mind_map') {
      const ans = await tools.mind.answer(message);
      result.content = `MINDMAP:\n${ans}`;
      toolCalls++;
    }

    ctx.hooks?.onTool?.(result);
    ctx.transcript.push(`TOOL[${action}] expected(${expected})\n${result.content.slice(0, 1200)}`);
    steps++;
  }

  return ctx;
}
