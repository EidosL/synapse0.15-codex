export interface Budget { maxTokens: number; perTurn: number; }
export function selectRecentTurns(turns: string[], budget: Budget) {
  const out: string[] = []; let used = 0; // crude token proxy by char length / 4
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]; const est = Math.ceil(t.length / 4);
    if (used + est > budget.maxTokens) break;
    out.unshift(t); used += est;
  }
  return out;
}
