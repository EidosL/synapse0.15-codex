import { canonicalize } from './aliasMap';

export type Frag = { noteId:string; parentId:string; childId:string; text:string; tokens:number };

const FEATURES = (text:string) => new Set(canonicalize(text));

const OVERLAP = (A:Set<string>, B:Set<string>) => {
  const inter = [...A].filter(x=>B.has(x)).length;
  return inter / Math.max(1, A.size + B.size - inter);
};

/** Greedy max-cover: pick fragments that add most new features per token. */
export function pickEvidenceSubmodular(
  pool: Frag[],                         // candidate fragments
  queryText: string,
  maxFragments: number,
  perNoteCap?: number,
  redundancyJaccard = 0.8
): Frag[] {
  const noteCount = new Set(pool.map(p => p.noteId)).size || 1;
  const cap = perNoteCap ?? Math.max(2, Math.ceil(maxFragments / noteCount));
  const qF = FEATURES(queryText);
  const candidates = pool.map(f => ({ f, F: FEATURES(f.text) }));

  const chosen: {f:Frag; F:Set<string>}[] = [];
  const covered = new Set<string>();
  const usedByNote = new Map<string, number>();

  while (chosen.length < maxFragments && candidates.length) {
    let bestIdx = -1, bestScore = -Infinity;

    for (let i=0;i<candidates.length;i++) {
      const { f, F } = candidates[i];
      // enforce per-note cap
      const used = usedByNote.get(f.noteId) ?? 0;
      if (used >= cap) continue;
      // redundancy filter
      if (chosen.some(x => OVERLAP(x.F, F) > redundancyJaccard)) continue;

      // coverage gain = new (F ∪ qF) − covered
      const newFeat = [...F, ...qF].filter(x => !covered.has(x)).length;
      const gainPerToken = newFeat / Math.max(1, f.tokens);
      if (gainPerToken > bestScore) { bestScore = gainPerToken; bestIdx = i; }
    }

    if (bestIdx < 0) break;
    const picked = candidates.splice(bestIdx,1)[0];
    chosen.push(picked);
    picked.F.forEach(x => covered.add(x));
    usedByNote.set(picked.f.noteId, (usedByNote.get(picked.f.noteId) ?? 0) + 1);
  }

  return chosen.map(x => x.f);
}
