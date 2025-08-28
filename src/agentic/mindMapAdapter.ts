// src/agentic/adapters/mindMapAdapter.ts
import { ai, MODEL_NAME, safeParseGeminiJson } from '../../lib/ai';
import { Type } from '@google/genai';
import type { MindMap } from '../types';

const MAP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    nodes: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
      id:{type:Type.STRING}, label:{type:Type.STRING}, kind:{type:Type.STRING}
    }, required:['id','label','kind']} },
    edges: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
      s:{type:Type.STRING}, t:{type:Type.STRING}, rel:{type:Type.STRING}
    }, required:['s','t','rel']} },
    summaries: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ['nodes','edges','summaries']
} as const;

export class MindMapAdapter {
  async buildFromTranscript(transcript: string): Promise<MindMap|null> {
    if (!ai) return null;
    const prompt = `Extract a MIND MAP from the transcript.
Return JSON with nodes (entity|concept|claim), edges (s,t,rel), and 1–3 short summaries.
Be faithful; no hallucinations.`;

    const stream = await ai.models.generateContentStream({
      model: MODEL_NAME,
      contents: `${prompt}\n---\n${transcript.slice(0, 6000)}\n---`,
      config: { responseMimeType:'application/json', responseSchema: MAP_SCHEMA, temperature: 0.2 }
    });
    let jsonText = '';
    for await (const chunk of stream) {
      jsonText += chunk.text ?? '';
    }
    return safeParseGeminiJson<MindMap>(jsonText);
  }
}
