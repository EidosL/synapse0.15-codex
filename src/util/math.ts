// Helpers
export const clip = (x:number, a=0, b=1) => Math.min(b, Math.max(a, x));
export const gain = (now:number, prev:number) => Math.max(0, now - prev); // improvement gate

export function rollingMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

// 1) Eureka: coherence + confidence + sustained gain
export function eurekaScore(
  simNow: number,            // your computeSimEst(...)
  simPrev: number,
  marginNow: number,         // sim_constraints in [0,1]
  entropyNow: number         // in [0,1]
): number {
  const coherence = simNow;              // high when we "fit"
  const confidence = marginNow * (1 - entropyNow);
  const jump = gain(simNow, simPrev);    // recent improvement only
  // Weighted mix; keep simple & bounded
  const raw = 0.45*coherence + 0.35*confidence + 0.20*jump;
  return clip(raw);
}

// 2) Serendipity: novelty + relevance + payoff
export function serendipityScore(
  noveltyRel: number,        // fraction of evidence not in query, 0..1
  simEntities: number,       // overlap with core entities, 0..1
  simNow: number,
  simPrev: number,
  entropyNow: number
): number {
  const relevance = simEntities;                   // anchors novelty to the task
  const payoff = gain(simNow, simPrev) * (1 - entropyNow);
  // Nonlinear encouragement for "meaningful novelty"
  const noveltyUseful = Math.sqrt(clip(noveltyRel)) * relevance;
  return clip(noveltyUseful * (0.6*payoff + 0.4*simNow));
}
