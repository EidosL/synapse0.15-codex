import { runAgenticInsight } from './agenticLoop';
import type { Tier } from './budget';

export async function maybeAutoDeepen({
  tier, topic, insightCore, evidenceTexts, tools, hooks
}:{
  tier: Tier; topic: string; insightCore: string;
  evidenceTexts: string[]; tools: { web:any; mind:any }; hooks?: any;
}) {
  if (tier !== 'pro') return null;

  // Very cheap gate: only deepen if evidence is thin or generic
  const thin = evidenceTexts.join(' ').length < 1200;
  if (!thin) return null;

  const ctx = await runAgenticInsight({
    tier, topic,
    transcript: [`INSIGHT: ${insightCore}`],
    mindHints: [],
    hooks
  }, tools);

  return ctx?.transcript.join('\n');
}
