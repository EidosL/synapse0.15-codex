export type ActionKind = string;

export type PlanStep = {
  action: ActionKind;
  message: string;     // query or instruction for the tool
  expected: string;    // what we hope to learn/verify
  stopWhen?: string[]; // optional completion hints
};

export type PlanJSON = { rationale: string; step: PlanStep };

export type ToolResult = {
  action: ActionKind;
  ok: boolean;
  content: string;                     // summarized, grounded output
  citations?: { url?: string; noteId?: string; childId?: string; quote?: string }[];
};

export type MindNode = { id:string; label:string; kind:'entity'|'concept'|'claim' };
export type MindEdge = { s:string; t:string; rel:string };
export type MindMap = { nodes: MindNode[]; edges: MindEdge[]; summaries: string[] };
