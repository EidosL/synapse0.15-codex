const tokenize = (s:string) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5\s]/g,' ').split(/\s+/).filter(Boolean);

export type Signals = {
  seedCoverage: number;     // 0..1 fraction of query terms covered in top evidence
  novelty: number;          // 0..1 how different candidate note vocab is vs. query
  rerankMargin: number;     // 0..1 margin between top2 scores
  entropy: number;          // 0..1 dispersion of candidate scores (uncertainty)
};

export function computeSignals(opts:{
  queries: string[];
  candidateScores: number[];   // normalized 0..1
  evidenceTexts: string[];     // current selected fragments
}) : Signals {
  const qset = new Set(opts.queries.flatMap(tokenize));
  const evTokens = new Set(opts.evidenceTexts.flatMap(tokenize));
  const inter = [...qset].filter(x => evTokens.has(x)).length;
  const seedCoverage = qset.size ? inter / qset.size : 0;

  // novelty: fraction of ev tokens not in queries
  const novel = [...evTokens].filter(x => !qset.has(x)).length;
  const novelty = (evTokens.size ? novel / evTokens.size : 0);

  const sorted = [...opts.candidateScores].sort((a,b)=>b-a);
  const top = sorted[0] ?? 0, second = sorted[1] ?? 0;
  const rerankMargin = Math.max(0, top - second);

  // entropy over candidate scores (discrete)
  const p = opts.candidateScores.map(x => Math.max(1e-9, x));
  const sum = p.reduce((a,b)=>a+b,0);
  const H = -p.map(x => x/sum).reduce((a,b)=> a + b*Math.log(b), 0);
  const entropy = 1 - Math.exp(-H); // squash to 0..1

  return { seedCoverage, novelty, rerankMargin, entropy };
}

export function shouldEscalate(s: Signals, estTokens: number, llmCalls: number, benefitThreshold=0.1) {
  // Plug your vendor $ here; these weights are relative cost proxies.
  const benefit = 0.5*s.seedCoverage + 0.3*s.novelty + 0.2*s.rerankMargin - 0.2*s.entropy;
  const price   = 0.00002*estTokens + 0.02*llmCalls; // tune coefficients
  return (benefit - price) > benefitThreshold;
}
