import { Type } from '@google/genai';
import { ai, MODEL_NAME, safeParseGeminiJson } from '../lib/ai';

const COUNTER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    counterEvidence: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
      noteId: { type: Type.STRING },
      childId:{ type: Type.STRING },
      quote:  { type: Type.STRING },
      rationale: { type: Type.STRING },
    }, required: ['noteId','childId','quote'] }},
    weakness: { type: Type.STRING },      // one crisp failure mode
    severity: { type: Type.NUMBER }       // 0..1 how lethal the counter is
  },
  required: ['counterEvidence','weakness','severity']
} as const;

export type CounterOut = { counterEvidence: {noteId:string; childId:string; quote:string; rationale?:string}[]; weakness:string; severity:number };

export async function counterInsightCheck(
  insightCore: string,
  evidence: {noteId:string; childId:string; text:string}[]
): Promise<CounterOut | null> {
  if (!ai) return null;
  const prompt = `You are an adversarial checker. Given an INSIGHT and its EVIDENCE snippets, find specific quotes that undermine the INSIGHT.

Rules:
- Use ONLY provided evidence. Return a JSON object with counterEvidence[], a one-line weakness, and a severity (0..1).
INSIGHT:
${insightCore}

EVIDENCE:
${evidence.map(e => `[${e.noteId}::${e.childId}] ${e.text}`).join('\n')}
`;
  const res = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: COUNTER_SCHEMA,
      temperature: 0.1,
    },
    safetySettings: [],
  });
  const parsed = safeParseGeminiJson<CounterOut>(
    res.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  );
  return parsed;
}
