export interface ChunkResponse {
  chunkId: string;
  noteId: string;
  noteTitle: string;
  content: string;
}

export async function fetchChunk(chunkId: string): Promise<ChunkResponse> {
  const r = await fetch(`/api/chunks/${encodeURIComponent(chunkId)}`);
  if (!r.ok) throw new Error(`Failed to fetch chunk ${chunkId}`);
  return await r.json();
}

