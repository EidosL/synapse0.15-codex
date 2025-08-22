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
      // Summarize to keep context lean
      const res = await ai?.models.generateContent({
        model: MODEL_NAME,
        contents: `Summarize key facts useful for: "${expected}". Use only these bullets, no new claims.\n${bullets}`
      });
      result.content = `WEB_SUMMARY:\n${res?.text ?? bullets}`;
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
