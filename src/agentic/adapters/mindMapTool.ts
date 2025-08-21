import type { MindMapTool } from '../types';
import { buildMindMapFromTranscript } from '../mindMap';

export const mindMapTool = (): MindMapTool => {
  let last = ''; let cache = { nodes:[], edges:[], summaries:[] };
  return {
    async update(transcript) {
      if (transcript === last) return cache;
      const mm = await buildMindMapFromTranscript(transcript);
      if (mm) { cache = mm; last = transcript; }
      return cache;
    },
    async answer(query) {
      const head = cache.summaries[0] ?? 'No summary yet';
      return `Context: ${head}\nQuery: ${query}`;
    }
  };
};
