import { ai, MODEL_NAME, safeParseGeminiJson } from '../lib/ai';
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
  if (!ai) return null;
  const prompt = `You are a planning agent for deep research.
Propose ONE minimal next step as JSON. Prefer ONLY: web_search, mind_map, finalize.
Use web_search to fetch missing facts; mind_map to extract/clarify entities/relations; finalize if sufficient.`;

  const contents = `${prompt}
MIND_HINTS:
- ${mindHints.join('\n- ')}

TRANSCRIPT:
${transcript.slice(0, 3000)}`;

  const res = await ai.models.generateContent({
    model: MODEL_NAME,
    contents,
    config: { responseMimeType:'application/json', responseSchema: PLAN_SCHEMA, temperature }
  });
  return safeParseGeminiJson<PlanJSON>(res.text);
}
