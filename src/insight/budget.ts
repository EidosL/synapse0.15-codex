export type Tier = 'free' | 'pro';

export type Budget = {
  maxQueries: number;     // query expansion + self-probe cap
  perQueryK: number;      // vector hits per query
  finalK: number;         // fused candidate notes
  maxFragments: number;   // evidence snippets per pair
  maxCycles: number;      // Como-style loop count
  tempProbe: number;      // temperature for self-probe
  tempInsight: number;    // temperature for insight prompt
  contextCapChars: number; // hard cap for evidence text payload
};

export const TIERS: Record<Tier, Budget> = {
  free: { maxQueries: 4,  perQueryK: 5,  finalK: 4,  maxFragments: 12, maxCycles: 1, tempProbe: 0.2, tempInsight: 0.2, contextCapChars: 3500 },
  pro:  { maxQueries: 10, perQueryK: 12, finalK: 8,  maxFragments: 24, maxCycles: 3, tempProbe: 0.7, tempInsight: 0.5, contextCapChars: 4500 }
};

export const policyFor = (tier: Tier) => TIERS[tier];
