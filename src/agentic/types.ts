export type ToolKind = 'none'|'finalize'|'web_search'|'mind_map';

export type PlanStep = {
  action: ToolKind;
  message: string;     // query or instruction for the tool
  expected: string;    // what we hope to learn/verify
  stopWhen?: string[]; // optional completion hints
};

export type PlanJSON = { rationale: string; step: PlanStep };

export type ToolResult = {
  action: ToolKind;
  ok: boolean;
  content: string;                     // summarized, grounded output
  citations?: { url?: string; noteId?: string; childId?: string; quote?: string }[];
};

export interface WebSearch {
  search(q: string, k: number): Promise<{title:string; snippet:string; url:string}[]>;
}

export type MindNode = { id:string; label:string; kind:'entity'|'concept'|'claim' };
export type MindEdge = { s:string; t:string; rel:string };
export type MindMap = { nodes: MindNode[]; edges: MindEdge[]; summaries: string[] };

export interface MindMapTool {
  update(transcript: string): Promise<MindMap>;
  answer(query: string): Promise<string>;
}
