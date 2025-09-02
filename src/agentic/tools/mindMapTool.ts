import type { MindMap, PlanStep, ToolResult } from '../types';
import type { Tool } from './tool';
import { safeParseGeminiJson, routeLlmCall } from '../../lib/ai';

// Optional Node.js-specific persistence layer
let NodeMindMapTool: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NodeMindMapTool = require('../../lib/mindMapTool').default;
} catch {
  // Browser environment or module not available
}

export class MindMapTool implements Tool {
  public name = 'mind_map';
  private lastTranscript = '';
  private cache: MindMap = { nodes: [], edges: [], summaries: [] };
  private persistedTool: any | null = null;
  private sessionId = 'synapse-session';

  constructor() {
    if (NodeMindMapTool) this.persistedTool = new NodeMindMapTool();
  }

  public async execute(step: PlanStep): Promise<ToolResult> {
    const answer = await this.answer(step.message);
    return { action: this.name, ok: true, content: `MINDMAP:\n${answer}` };
  }

  public async update(transcript: string): Promise<MindMap> {
    if (transcript !== this.lastTranscript) {
      const mm = await this._buildFromTranscript(transcript);
      if (mm) {
        this.cache = mm;
        this.lastTranscript = transcript;
        if (this.persistedTool) {
          const graph = {
            nodes: mm.nodes.map((n: any) => ({ id: n.id, title: n.label ?? n.id, summary: '', embedding: [], childChunkIds: [] })),
            relations: mm.edges.map((e: any) => ({ sourceId: e.s, targetId: e.t, description: e.rel ?? 'related' }))
          };
          this.persistedTool.mergeGraph(this.sessionId, graph);
        }
      }
    }
    return this.cache;
  }

  private async answer(query: string): Promise<string> {
    if (this.persistedTool) return this.persistedTool.answer(this.sessionId, query);
    const head = this.cache.summaries[0] ?? 'No summary yet';
    return `Context: ${head}\nQuery: ${query}`;
  }

  private async _buildFromTranscript(transcript: string): Promise<MindMap | null> {
    try {
      const resp = await routeLlmCall('mindMapExtract', [
        { role: 'system', content: 'Extract a mind map as strict JSON: {"nodes":[{"id","label","kind"}],"edges":[{"s","t","rel"}],"summaries":[string]}. No extra text.' },
        { role: 'user', content: transcript.slice(0, 6000) }
      ], { temperature: 0.2 });
      const text = resp?.choices?.[0]?.message?.content ?? '';
      return safeParseGeminiJson<MindMap>(typeof text === 'string' ? text : '');
    } catch (e) {
      console.error('mindMapExtract routing failed:', e);
      return null;
    }
  }
}

