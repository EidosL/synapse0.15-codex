export type Tier = 'free' | 'pro';

export type Budget = {
  maxQueries: number;     // query expansion + self-probe cap
  perQueryK: number;      // vector hits per query
  finalK: number;         // fused candidate notes
  randomInject: number;   // random notes to inject for serendipity
  maxFragments: number;   // evidence snippets per pair
  maxCycles: number;      // Como-style loop count
  tempProbe: number;      // temperature for self-probe
  tempInsight: number;    // temperature for insight prompt
  contextCapChars: number; // hard cap for evidence text payload
};

export const TIERS: Record<Tier, Budget> = {
  free: { maxQueries: 4,  perQueryK: 5,  finalK: 4,  randomInject: 1, maxFragments: 12, maxCycles: 1, tempProbe: 0.2, tempInsight: 0.2, contextCapChars: 3500 },
  pro:  { maxQueries: 10, perQueryK: 12, finalK: 8,  randomInject: 2, maxFragments: 24, maxCycles: 3, tempProbe: 0.7, tempInsight: 0.5, contextCapChars: 4500 }
};

export const policyFor = (tier: Tier) => TIERS[tier];

// New: adapt tier policy using uncertainty/novelty signals (best-effort typing)
export type SignalSnapshot = { uncertainty?: number; novelty?: number; thinEvidence?: boolean } & Record<string, any>;

export const deriveBudget = (tier: Tier, s: SignalSnapshot): Budget => {
  const base = { ...TIERS[tier] };
  const u = s.uncertainty ?? 0;             // 0..1
  const thin = !!s.thinEvidence;
  // scale queries & cycles up with uncertainty; keep caps modest to control cost
  base.maxQueries = Math.min(TIERS[tier].maxQueries, Math.max(3, Math.round(3 + u * 7)));
  base.maxCycles  = Math.min(TIERS[tier].maxCycles, 1 + (u > 0.6 ? 2 : u > 0.3 ? 1 : 0));
  // if evidence is thin, allow one extra pass and more fragments
  if (thin) { base.maxFragments = Math.min(base.maxFragments + 6, TIERS[tier].maxFragments + 6); }
  return base;
};
