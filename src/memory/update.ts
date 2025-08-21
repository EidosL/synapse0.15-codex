import { RoleCard, RoleCardSchema } from "./types";

export function summarizeRoleCard(card: RoleCard): string {
  // compact  ~200 tokens max
  const pick = (xs: string[], n: number) => xs.slice(0, n).join("; ");
  return `Role:${card.role}. Goals:${pick(card.goals,3)}. Constraints:${pick(card.constraints,3)}. Key decisions:${pick(card.decisions,5)}. Unknowns:${pick(card.unknowns,3)}.`;
}

export function evictFromCard(card: RoleCard, maxDecisions = 50) {
  // Keep recent, drop low-signal items; always retain unknowns[]
  if (card.decisions.length > maxDecisions) card.decisions = card.decisions.slice(-maxDecisions);
  card.updatedAt = Date.now();
  return card;
}

export function updateCardWithOutput(card: RoleCard, agentOutput: string) {
  // Very light extractor to avoid template overfitting. In prod, swap with LLM function call.
  const lines = agentOutput.split(/\n|\.|;/).map(s=>s.trim()).filter(Boolean);
  for (const L of lines) {
    if (/\b(decide|we will|chose|select)\b/i.test(L)) card.decisions.push(L);
    if (/\b(risk|block|constraint|must|never)\b/i.test(L)) card.constraints.push(L);
    if (/\b(assume|believe|hypothesis)\b/i.test(L)) card.beliefs.push(L);
    if (/\b(todo|tbd|unknown|unclear|need to find)\b/i.test(L)) card.unknowns.push(L);
  }
  return evictFromCard(card);
}
