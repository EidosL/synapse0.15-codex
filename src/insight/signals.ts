const tokenize = (s:string) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5\s]/g,' ').split(/\s+/).filter(Boolean);

export type Signals = {
  sim_entities: number;     // 0..1 fraction of query terms covered in top evidence
  sim_relations: number;    // 0..1 how different candidate note vocab is vs. query
  sim_constraints: number;  // 0..1 margin between top2 scores
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
  const sim_entities = qset.size ? inter / qset.size : 0;

  // novelty: fraction of ev tokens not in queries
  const novel = [...evTokens].filter(x => !qset.has(x)).length;
  const sim_relations = (evTokens.size ? novel / evTokens.size : 0);

  const sorted = [...opts.candidateScores].sort((a,b)=>b-a);
  const top = sorted[0] ?? 0, second = sorted[1] ?? 0;
  const sim_constraints = Math.max(0, top - second);

  // entropy over candidate scores (discrete)
  const p = opts.candidateScores.map(x => Math.max(1e-9, x));
  const sum = p.reduce((a,b)=>a+b,0);
  const H = -p.map(x => x/sum).reduce((a,b)=> a + b*Math.log(b), 0);
  const entropy = 1 - Math.exp(-H); // squash to 0..1

  return { sim_entities, sim_relations, sim_constraints, entropy };
}

/**
 * Computes the similarity estimate (sim_est) based on the WFGY spec.
 * sim_est = w_e*sim(entities) + w_r*sim(relations) + w_c*sim(constraints)
 */
export function computeSimEst(s: Signals, weights = { e: 0.5, r: 0.3, c: 0.2 }): number {
  const sim_est = weights.e * s.sim_entities +
                  weights.r * s.sim_relations +
                  weights.c * s.sim_constraints;
  return sim_est;
}

/**
 * Computes the tension signal (delta_s) based on the WFGY spec.
 * delta_s = 1 - sim_est
 */
export function computeDeltaS(sim_est: number): number {
  return 1 - sim_est;
}
