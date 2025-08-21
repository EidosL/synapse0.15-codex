// src/insight/verifier.ts
import { searchWeb } from '../agentic/adapters/searchWeb';

export type Candidate = { text: string; prior?: number };
export type Verification = {
  candidate: Candidate;
  verdict: 'supported' | 'refuted' | 'uncertain';
  notes: string;
  citations: { url: string; snippet: string }[];
};

export async function verifyCandidates(
  q: string, candidates: Candidate[], maxSites = 3
): Promise<Verification[]> {
  const out: Verification[] = [];
  for (const cand of candidates) {
    const query = `${q} "${cand.text}"`;
    const results = await searchWeb.search(query, maxSites);
    // naive scoring: any snippet explicitly affirming the candidate boosts support
    let score = 0, cites: { url: string; snippet: string }[] = [];
    for (const r of results) {
      cites.push({ url: r.url, snippet: r.snippet ?? r.summary ?? '' });
      const s = (r.snippet ?? r.summary ?? '').toLowerCase();
      if (s.includes(cand.text.toLowerCase())) score++;
    }
    const verdict = score >= 1 ? 'supported' : (results.length ? 'uncertain' : 'refuted');
    out.push({ candidate: cand, verdict, notes: `score=${score}`, citations: cites.slice(0, maxSites) });
  }
  return out;
}
