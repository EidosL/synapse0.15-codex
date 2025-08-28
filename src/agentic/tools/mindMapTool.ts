import type { MindMap, PlanStep, ToolResult } from '../types';
import type { Tool } from './tool';
import { ai, MODEL_NAME, safeParseGeminiJson } from '../../lib/ai';
import { Type } from '@google/genai';

// This is the Node.js-specific part for persistence.
// The dynamic import needs to be handled carefully in the constructor.
let NodeMindMapTool: any = null;
try {
  NodeMindMapTool = require('../../lib/mindMapTool').default;
} catch (e) {
  console.log("Running in a browser environment or Node.js-specific tool not found.");
}


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


export class MindMapTool implements Tool {
  public name = 'mind_map';
  private lastTranscript = '';
  private cache: MindMap = { nodes: [], edges: [], summaries: [] };
  private persistedTool: any | null = null; // Should be instance of NodeMindMapTool if available
  private sessionId = 'synapse-session';

  constructor() {
    if (NodeMindMapTool) {
      this.persistedTool = new NodeMindMapTool();
    }
  }

  public async execute(step: PlanStep): Promise<ToolResult> {
    const answer = await this.answer(step.message);
    return {
      action: this.name,
      ok: true,
      content: `MINDMAP:\n${answer}`,
    };
  }

  public async update(transcript: string): Promise<MindMap> {
    if (transcript !== this.lastTranscript) {
      const mm = await this._buildFromTranscript(transcript);
      if (mm) {
        this.cache = mm;
        this.lastTranscript = transcript;
        if (this.persistedTool) {
          const graph = {
            nodes: mm.nodes.map((n: any) => ({
              id: n.id, title: n.label ?? n.id,
              summary: '', embedding: [], childChunkIds: []
            })),
            relations: mm.edges.map((e: any) => ({
              sourceId: e.s, targetId: e.t,
              description: e.rel ?? 'related'
            }))
          };
          this.persistedTool.mergeGraph(this.sessionId, graph);
        }
      }
    }
    return this.cache;
  }

  private async answer(query: string): Promise<string> {
    if (this.persistedTool) {
      return this.persistedTool.answer(this.sessionId, query);
    }
    const head = this.cache.summaries[0] ?? 'No summary yet';
    return `Context: ${head}\nQuery: ${query}`;
  }

  private async _buildFromTranscript(transcript: string): Promise<MindMap|null> {
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
