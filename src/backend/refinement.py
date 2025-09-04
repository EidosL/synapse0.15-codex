import os
import json
import asyncio
from typing import List, Dict, Any, Optional

from src.synapse.config.llm import llm_text

async def run_self_evolution(final_draft: str) -> str:
    """
    Refines an insight by generating variants, evaluating them, and merging the best ones.
    """
    # === 1. Variant Generation ===
    focuses = [
        "highlighting technical depth and specific evidence, creating a rigorous, academic tone",
        "emphasizing broad connections and analogies to other fields, creating a creative, lateral-thinking tone",
        "focusing on practical implications and actionable outcomes, creating a pragmatic, business-oriented tone",
    ]

    async def _gen_variant(focus: str) -> str:
        prompt = (
            "You are an expert researcher. Refine the insight draft with a specific focus.\n"
            f"Focus: {focus}.\n\nDraft:\n'''\n{final_draft}\n'''\n"
            "Return ONLY the refined draft text."
        )
        try:
            return (await llm_text('runSelfEvolution', prompt, temperature=0.7)).strip()
        except Exception:
            return ""

    variant_responses = await asyncio.gather(*[_gen_variant(f) for f in focuses], return_exceptions=False)
    variants = [v.strip() for v in variant_responses if isinstance(v, str) and v.strip()]
    variants.append(final_draft)
    variants = list(set(v for v in variants if len(v) > 20))

    if len(variants) < 2:
        return final_draft

    # === 2. Evaluation ===
    variants_block = "\n\n".join([
        f"Insight Variant #{i + 1}:\n\"\"\"\n{v}\n\"\"\"" for i, v in enumerate(variants)
    ])
    eval_prompt = f"""You are an evaluator. You will be given multiple proposed insights. Score each from 1 to 10 on overall quality (is it convincing, well-supported, novel, and clear?). Also, provide brief feedback on its strengths or weaknesses.

{variants_block}

Respond with ONLY a valid JSON list of objects, like this: {{"variant": 1, "score": 8, "feedback": "..."}}]."""

    evaluations = []
    try:
        text = await llm_text('runSelfEvolution', eval_prompt, temperature=0.2)
        evaluations = json.loads(text)
    except Exception as e:
        print(f"Self-evolution (evaluation) failed: {e}")

    # === 3. Merging ===
    if evaluations:
        evaluations.sort(key=lambda x: x.get('score', 0), reverse=True)
    else:
        # Fallback if eval fails
        evaluations = [{"variant": i + 1} for i in range(len(variants))]

    top_variants_indices = [e['variant'] - 1 for e in evaluations[:2]]
    top_variants = [variants[i] for i in top_variants_indices if 0 <= i < len(variants)]

    if len(top_variants) < 2:
        return top_variants[0] if top_variants else final_draft

    merge_prompt = f"""You are a master synthesizer. Your task is to merge the best aspects of the following insight drafts into a single, superior insight.

Draft 1:
'''
{top_variants[0]}
'''

Draft 2:
'''
{top_variants[1]}
'''

Guidelines:
- Preserve the most important evidence, arguments, and novel ideas from each draft.
- Ensure the merged insight is coherent, well-structured, and not repetitive.
- Create a concise, clear narrative that includes the key points from both drafts.
Return ONLY the merged insight text."""

    try:
        text = await llm_text('runSelfEvolution', merge_prompt, temperature=0.4)
        return text.strip() or top_variants[0]
    except Exception as e:
        print(f"Self-evolution (merging) failed: {e}")
        return top_variants[0] # Fallback to the best variant


from src.utils import core_web_search

async def verify_candidates(
    query: str,
    candidates: List[Dict[str, Any]],
    max_sites: int = 3
) -> List[Dict[str, Any]]:
    """
    Verifies a list of candidate insights using web search.
    TODO(reliability/perf):
    - Parallelize per-candidate searches (async gather with rate limits)
    - Improve matching (title weighting, fuzzy/snippet similarity, domain trust)
    - Provider abstraction (add Bing/HF/Serper fallback; retry policy)
    - Caching of queries and per-run dedupe to reduce cost
    - Add tracing + usage metrics; expose thresholds via config
    """
    verifications = []
    for cand in candidates:
        search_query = f'{query} "{cand["text"]}"'
        search_results = await core_web_search(search_query, max_sites)

        score = 0
        citations = []
        for r in search_results:
            citations.append({"url": r.get("url"), "snippet": r.get("snippet")})
            s = r.get("snippet", "").lower()
            if cand["text"].lower() in s:
                score += 1

        verdict = "supported" if score >= 1 else ("uncertain" if search_results else "refuted")

        verifications.append({
            "candidate": cand,
            "verdict": verdict,
            "notes": f"score={score}",
            "citations": citations[:max_sites]
        })

    return verifications
