import os
import json
import asyncio
from typing import List, Dict, Any, Optional

import google.generativeai as genai

async def run_self_evolution(final_draft: str) -> str:
    """
    Refines an insight by generating variants, evaluating them, and merging the best ones.
    """
    API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not API_KEY:
        return final_draft
    genai.configure(api_key=API_KEY)
    model = genai.GenerativeModel('gemini-1.5-flash')

    # === 1. Variant Generation ===
    focuses = [
        "highlighting technical depth and specific evidence, creating a rigorous, academic tone",
        "emphasizing broad connections and analogies to other fields, creating a creative, lateral-thinking tone",
        "focusing on practical implications and actionable outcomes, creating a pragmatic, business-oriented tone",
    ]

    variant_tasks = []
    for focus in focuses:
        prompt = f"""You are an expert researcher. Your task is to refine the following insight draft with a specific focus.
Focus: {focus}.

Draft:
'''
{final_draft}
'''
Return ONLY the refined draft text."""
        variant_tasks.append(model.generate_content_async(prompt, generation_config={"temperature": 0.7}))

    variant_responses = await asyncio.gather(*variant_tasks, return_exceptions=True)
    variants = [r.text.strip() for r in variant_responses if not isinstance(r, Exception) and r.text]
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
        eval_schema = {"type": "array", "items": {"type": "object", "properties": {"variant": {"type": "number"}, "score": {"type": "number"}, "feedback": {"type": "string"}}, "required": ["variant", "score", "feedback"]}}
        eval_response = await model.generate_content_async(eval_prompt, generation_config={"response_mime_type": "application/json", "response_schema": eval_schema})
        evaluations = json.loads(eval_response.text)
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
        merge_response = await model.generate_content_async(merge_prompt, generation_config={"temperature": 0.4})
        return merge_response.text.strip()
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
