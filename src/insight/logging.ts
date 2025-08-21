export type Metrics = {
  tier: 'free'|'pro';
  depthCycles: number;
  tokensEstimated: number;
  llmCalls: number;
  candidateNotes: number;
  evidenceSnippets: number;
  signals?: { seedCoverage:number; novelty:number; rerankMargin:number; entropy:number };
  mode?: 'eureka'|'serendipity'|'none';
  latencyMs?: number;
};

export const logMetrics = (m: Metrics) => {
  try { console.debug('[InsightMetrics]', JSON.stringify(m)); } catch {}
};
