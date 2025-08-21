// src/agentic/adapters/mindMapTool.ts
import type { MindMapTool as IMindMap } from '../types';
import { buildMindMapFromTranscript } from '../mindMap';

// Try to import the Node-side tool if available (server/runtime)
let NodeMindMap: any = null;
try { NodeMindMap = (await import('../../lib/mindMapTool')).default; } catch {}

export const mindMapTool = (): IMindMap => {
  let last = '';
  let cache = { nodes: [], edges: [], summaries: [] as string[] };

  // Optional persisted tool (Node)
  const persisted = NodeMindMap ? new NodeMindMap() : null;
  const SESSION_ID = 'synapse-session';

  return {
    async update(transcript: string) {
      if (transcript !== last) {
        const mm = await buildMindMapFromTranscript(transcript);
        if (mm) {
          cache = mm;
          last = transcript;
          if (persisted) {
            // normalize to KnowledgeGraph shape expected by lib/mindMapTool
            const graph = {
              nodes: mm.nodes.map((n: any) => ({
                id: n.id, title: n.title ?? n.text ?? n.id,
                summary: n.summary ?? '', embedding: [], childChunkIds: []
              })),
              relations: mm.edges.map((e: any) => ({
                sourceId: e.source, targetId: e.target,
                description: e.label ?? 'related'
              }))
            };
            persisted.mergeGraph(SESSION_ID, graph);
          }
        }
      }
      return cache;
    },
    async answer(query: string) {
      if (persisted) return persisted.answer(SESSION_ID, query);
      const head = cache.summaries[0] ?? 'No summary yet';
      return `Context: ${head}\nQuery: ${query}`;
    }
  };
};
