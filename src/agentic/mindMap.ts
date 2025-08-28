import { MindMapAdapter } from './mindMapAdapter';
import type { MindMap } from './types';

const mindMapAdapter = new MindMapAdapter();

export async function buildMindMapFromTranscript(transcript: string): Promise<MindMap|null> {
  return mindMapAdapter.buildFromTranscript(transcript);
}
