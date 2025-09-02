import { ai, MODEL_NAME, safeParseGeminiJson, routeLlmCall } from '../lib/ai';
import { Type } from '@google/genai';
import type { PlanJSON } from './types';

const PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rationale: { type: Type.STRING },
    step: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING }, // 'web_search' | 'mind_map' | 'finalize' | 'none'
        message:{ type: Type.STRING },
        expected:{ type: Type.STRING },
        stopWhen:{ type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ['action','message','expected']
    }
  },
  required: ['rationale','step']
} as const;

export async function planNextStep(
  transcript: string,
  mindHints: string[],
  temperature = 0.4
): Promise<PlanJSON|null> {
  const prompt = `You are a planning agent for deep research. Your goal is to formulate a plan to resolve an insight.
You can take several steps. Propose ONE step at a time.

Your available actions are:
- web_search: Use when you need external information, facts, or context. (e.g., "search for the definition of 'Bayesian Surprise'")
- mind_map: Use to explore the relationships between concepts already in the transcript. (e.g., "explore the link between 'Insight' and 'Serendipity'")
- continue: Use when you have gathered information and need to think or formulate the next question. Your 'message' should be your internal monologue.
- finalize: Use ONLY when you have a complete answer and no further steps are needed. Your 'message' should be the final conclusion.

Analyze the transcript and propose the next logical step.`;

  const contents = `${prompt}
MIND_HINTS:
- ${mindHints.join('\n- ')}

TRANSCRIPT:
${transcript.slice(0, 3000)}`;

  // Prefer Vercel AI Gateway (DeepSeek) if configured; fall back to Gemini JSON schema mode
  try {
    const resp = await routeLlmCall('planNextStep', [
      { role: 'system', content: 'Return strict JSON matching the schema: {"rationale": string, "step": {"action": string, "message": string, "expected": string, "stopWhen"?: string[]}}. No extra text.' },
      { role: 'user', content: contents }
    ], { temperature });
    const choice = resp.choices?.[0]?.message?.content;
    const text = typeof choice === 'string' ? choice : Array.isArray(choice) ? choice.map(p=> (typeof p === 'string' ? p : (p as any).text || '')).join('') : '';
    const plan = safeParseGeminiJson<PlanJSON>(text);
    if (plan) return plan;
  } catch (e) {
    // ignore and fall back
  }

  if (!ai) return null;
  const stream = await ai.models.generateContentStream({
    model: MODEL_NAME,
    contents: [{ role: 'user', parts: [{ text: contents }] }],
    // @ts-ignore
    config: { responseMimeType:'application/json', responseSchema: PLAN_SCHEMA, temperature }
  });
  let jsonText = '';
  for await (const chunk of stream) {
    jsonText += chunk.text ?? '';
  }
  const plan = safeParseGeminiJson<PlanJSON>(jsonText);
  return plan;
}
