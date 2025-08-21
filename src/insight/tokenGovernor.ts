// very rough token estimator: chars/4 (tune if you switch models)
export const estTokens = (s:string) => Math.ceil(s.length / 4);

export function capFragmentsByBudget<T extends {text:string}>(frags:T[], charBudget:number): T[] {
  const out:T[] = [];
  let used = 0;
  for (const f of frags) {
    const t = f.text.length > 280 ? (f.text.slice(0,279)+'…') : f.text;
    const cost = t.length;
    if (used + cost > charBudget) break;
    out.push({...f, text: t});
    used += cost;
  }
  return out;
}
