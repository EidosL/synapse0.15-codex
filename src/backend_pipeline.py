import asyncio
import json
import os
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

import google.generativeai as genai
from src.eureka_rag.main import run_chunk_pipeline
from src.eureka_rag.models import ChunkInput
from src.agentic_py.loop import maybe_auto_deepen
from src.progress import ProgressReporter
from src.jobs import Phase, Insight, JobResult
from sqlalchemy.ext.asyncio import AsyncSession
from src.eureka_rag.retrieval import generate_search_queries, retrieve_candidate_notes
from src.backend.ranking import rank_insights

# --- Pipeline-specific Models ---
class PipelineInput(BaseModel):
    source_note_id: str
    notes: List[Dict[str, Any]]

# --- AI & Synthesis Logic ---

INSIGHT_SCHEMA = {
    "type": "object", "properties": {
        "mode": {"type": "string"}, "reframedProblem": {"type": "string"}, "insightCore": {"type": "string"},
        "selectedHypothesisName": {"type": "string"},
        "hypotheses": { "type": "array", "items": { "type": "object", "properties": { "name": {"type": "string"}, "statement": {"type": "string"}, "predictedEvidence": {"type": "array", "items": {"type": "string"}}, "disconfirmers": {"type": "array", "items": {"type": "string"}}, "prior": {"type": "number"}, "posterior": {"type": "number"}, }, "required": ["name", "statement", "predictedEvidence", "disconfirmers", "prior", "posterior"]}},
        "eurekaMarkers": { "type": "object", "properties": { "suddennessProxy": {"type": "number"}, "fluency": {"type": "number"}, "conviction": {"type": "number"}, "positiveAffect": {"type": "number"}, }, "required": ["suddennessProxy", "fluency", "conviction", "positiveAffect"]},
        "bayesianSurprise": {"type": "number"},
        "evidenceRefs": { "type": "array", "items": { "type": "object", "properties": { "noteId": {"type": "string"}, "childId": {"type": "string"}, "quote": {"type": "string"}, }, "required": ["noteId", "childId", "quote"]}},
        "test": {"type": "string"}, "risks": {"type": "array", "items": {"type": "string"}},
    }, "required": ["mode", "reframedProblem", "insightCore", "selectedHypothesisName", "hypotheses", "eurekaMarkers", "bayesianSurprise", "evidenceRefs", "test", "risks"]
}

async def generate_insight(evidence_chunks: List[Dict[str, str]]) -> Optional[Dict[str, Any]]:
    API_KEY = os.getenv("GOOGLE_API_KEY")
    if not API_KEY: return None
    genai.configure(api_key=API_KEY)
    model = genai.GenerativeModel('gemini-1.5-pro')
    prompt = "You are an Insight Engine... Find a deep, non-obvious connection...\n" + "\n".join([f"[{c['noteId']}::{c.get('childId', '')}] {c['text']}" for c in evidence_chunks])
    try:
        response = await model.generate_content_async(prompt, generation_config={"response_mime_type": "application/json", "response_schema": INSIGHT_SCHEMA, "temperature": 0.7})
        return json.loads(response.text)
    except Exception as e:
        print(f"Error generating insight: {e}")
        return None

async def run_synthesis_and_ranking(source_note: Dict[str, Any], candidate_notes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    tasks = []
    evidence_map = {}
    # I need to associate the candidate note id with the insight.
    # The insight generation is async, so I'll use a tuple to track the cand_note
    tasks_with_context = []

    for i, cand_note in enumerate(candidate_notes):
        source_chunks = [{"noteId": source_note['id'], "text": p} for p in source_note['content'].split('\n\n')[:2]]
        cand_chunks = [{"noteId": cand_note['id'], "text": p} for p in cand_note['content'].split('\n\n')[:2]]
        evidence = source_chunks + cand_chunks
        task = generate_insight(evidence)
        tasks_with_context.append((task, cand_note['id'], evidence))

    generated_results = await asyncio.gather(*[t[0] for t in tasks_with_context])

    insights_with_context = []
    for i, insight in enumerate(generated_results):
        if insight and insight.get("mode") != "none":
            _, cand_note_id, evidence = tasks_with_context[i]
            insight['oldNoteId'] = cand_note_id
            insights_with_context.append({'insight': insight, 'evidence': evidence})

    if not insights_with_context:
        return []

    final_insights = [item['insight'] for item in insights_with_context]
    final_evidence_map = {str(i): item['evidence'] for i, item in enumerate(insights_with_context)}

    ranked = await rank_insights(final_insights, final_evidence_map)

    return ranked[:3]

async def generate_constellation_insight(evidence_chunks: List[Dict[str, str]]) -> Optional[Dict[str, Any]]:
    """
    Generates a 3-way "constellation" insight.
    """
    API_KEY = os.getenv("GOOGLE_API_KEY")
    if not API_KEY: return None
    genai.configure(api_key=API_KEY)
    model = genai.GenerativeModel('gemini-1.5-pro')

    prompt = f"""You are a "Constellation" Insight Engine. Your goal is to find a deep, non-obvious connection that **unites all three** of the provided evidence sources.
Identify a unifying theme, pattern, analogy, or principle. Frame the insight as a "constellation" that reveals how all three are related.
RULES:
- You MUST use ONLY the provided evidence chunks.
- Ground your entire analysis in the provided evidence. Do not invent information.
- Return ONLY a single, valid JSON object matching the schema.

EVIDENCE CHUNKS (from 3 notes):
---
{chr(10).join([f"[{c['noteId']}::{c.get('childId', '')}] {c['text']}" for c in evidence_chunks])}
---"""

    try:
        response = await model.generate_content_async(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": INSIGHT_SCHEMA,
                "temperature": 0.7
            }
        )
        payload = json.loads(response.text)
        return payload if payload and payload.get("mode") != "none" else None
    except Exception as e:
        print(f"Error in generate_constellation_insight: {e}")
        return None

async def find_bridging_insight(
    base_insight: Dict[str, Any],
    source_note: Dict[str, Any],
    all_notes: List[Dict[str, Any]],
    db: AsyncSession,
) -> Optional[Dict[str, Any]]:
    """
    Tries to find a 3-way "constellation" insight by finding a bridging note.
    """
    note_a_id = base_insight.get('oldNoteId')
    note_a = next((n for n in all_notes if n['id'] == note_a_id), None)
    if not note_a:
        return None

    # 1. Find bridge candidates related to Note A
    bridge_queries = await generate_search_queries(note_a.get('title', ''), note_a.get('content', ''), max_queries=5)
    if not bridge_queries:
        return None

    notes_to_search = [n for n in all_notes if n['id'] not in [source_note['id'], note_a_id]]
    bridge_cand_ids = await retrieve_candidate_notes(
        queries=bridge_queries,
        db=db,
        all_notes=notes_to_search,
        exclude_note_id=note_a_id,
        top_k=2
    )

    bridge_cands = [n for n in all_notes if n['id'] in bridge_cand_ids]
    if not bridge_cands:
        return None

    # 2. Synthesize a 3-way "constellation" insight for each bridge
    best_constellation = None

    for note_b in bridge_cands:
        # For simplicity, we'll just take the first couple of paragraphs from each note as evidence
        source_chunks = [{"noteId": source_note['id'], "text": p} for p in source_note['content'].split('\n\n')[:2]]
        note_a_chunks = [{"noteId": note_a['id'], "text": p} for p in note_a['content'].split('\n\n')[:2]]
        note_b_chunks = [{"noteId": note_b['id'], "text": p} for p in note_b['content'].split('\n\n')[:2]]

        evidence_chunks = source_chunks + note_a_chunks + note_b_chunks

        insight_payload = await generate_constellation_insight(evidence_chunks)

        if insight_payload:
            # Add context for ranking and downstream use
            insight_payload['newNoteId'] = source_note['id']
            insight_payload['oldNoteId'] = note_b['id'] # The "old" note is now the bridge note
            insight_payload['confidence'] = insight_payload.get('eurekaMarkers', {}).get('conviction', 0)
            insight_payload['constellationSourceIds'] = [source_note['id'], note_a_id, note_b['id']]

            if (insight_payload['confidence']) > (best_constellation.get('confidence', 0) if best_constellation else 0):
                best_constellation = insight_payload

    return best_constellation


# --- Main Pipeline Orchestrator ---
async def run_full_insight_pipeline(inp: PipelineInput, progress: ProgressReporter, db: AsyncSession) -> JobResult:
    await progress.update(Phase.candidate_selection, 5)
    all_chunks = [ChunkInput(id=f"{n['id']}:{i}", document_id=n['id'], text=p) for n in inp.notes for i, p in enumerate(n['content'].split('\n\n')) if p.strip()]
    if not all_chunks: raise ValueError("No chunks could be created from the provided notes.")

    cluster_result = run_chunk_pipeline(all_chunks)
    if not cluster_result: raise ValueError("Clustering pipeline failed to return results.")

    await progress.update(Phase.candidate_selection, 15, metrics_delta={"clusters": len(cluster_result.cluster_summaries)})

    source_chunks = {c.id for c in all_chunks if c.document_id == inp.source_note_id}
    relevant_clusters = {cluster_result.chunk_to_cluster_map.get(cid) for cid in source_chunks} - {None}
    candidate_ids = {cid.split(':')[0] for cid, clid in cluster_result.chunk_to_cluster_map.items() if clid in relevant_clusters and cid.split(':')[0] != inp.source_note_id}

    source_note = next((n for n in inp.notes if n['id'] == inp.source_note_id), None)
    candidate_notes = [n for n in inp.notes if n['id'] in candidate_ids]

    if not candidate_notes or not source_note: raise ValueError("Could not find source note or candidate notes after clustering.")

    await progress.update(Phase.candidate_selection, 30, metrics_delta={"notes_considered": len(candidate_notes)})

    # 2. Synthesis and Ranking
    top_insights_data = await run_synthesis_and_ranking(source_note, candidate_notes)
    if not top_insights_data:
        raise ValueError("Synthesis engine produced no valid insights.")

    partial_results = [Insight(insight_id=f"temp-{i}", title=d.get('insightCore', 'Untitled Insight'), score=d.get('score', 0)) for i, d in enumerate(top_insights_data)]
    await progress.update(Phase.initial_synthesis, 50, partial=partial_results)

    # 2.5. Multi-hop "Bridging" Insight
    await progress.update(Phase.multi_hop, 55)

    constellation_insight = await find_bridging_insight(
        base_insight=top_insights_data[0],
        source_note=source_note,
        all_notes=inp.notes,
        db=db
    )

    if constellation_insight and constellation_insight.get('confidence', 0) > top_insights_data[0].get('confidence', 0):
        top_insights_data.insert(0, constellation_insight)
        top_insights_data = top_insights_data[:3] # Keep top 3
        await progress.update(Phase.multi_hop, 60, message="Found a superior constellation insight.")
    else:
        await progress.update(Phase.multi_hop, 60)

    # 3. Agentic Refinement
    top_insight = top_insights_data[0]
    evidence_texts = [ref['quote'] for ref in top_insight.get('evidenceRefs', []) if 'quote' in ref]

    refined_transcript = await maybe_auto_deepen(
        tier='pro', topic=source_note.get('title', ''),
        insight_core=top_insight.get('insightCore', ''), evidence_texts=evidence_texts
    )

    if refined_transcript:
        top_insight['agenticTranscript'] = refined_transcript
        top_insight['insightCore'] += ' — refined via agentic research'
        # Boost confidence slightly after refinement
        top_insight['score'] = top_insight.get('score', 0) * 1.1

    await progress.update(Phase.agent_refinement, 80)

    # 4. Self-Evolution and Verification
    from .backend.refinement import run_self_evolution, verify_candidates

    # Self-Evolution on the top insight
    evolved_core = await run_self_evolution(top_insight.get('insightCore', ''))
    if evolved_core != top_insight.get('insightCore'):
        top_insight['insightCore'] = evolved_core
        top_insight['score'] = top_insight.get('score', 0) * 1.1 # Boost score after evolution

    # Grounded Verification
    candidates_to_verify = [{'text': h['statement']} for h in top_insight.get('hypotheses', [])]
    candidates_to_verify.insert(0, {'text': top_insight.get('insightCore', '')})

    query = source_note.get('title', '') or source_note.get('content', '')[:120]
    verdicts = await verify_candidates(query, candidates_to_verify)

    supported_verdict = next((v for v in verdicts if v['verdict'] == 'supported'), verdicts[0] if verdicts else None)

    if supported_verdict:
        top_insight['insightCore'] = supported_verdict['candidate']['text']
        top_insight['verification'] = supported_verdict
        if supported_verdict['verdict'] == 'supported':
            top_insight['score'] = max(top_insight.get('score', 0), 0.85)


    await progress.update(Phase.finalizing, 90)


    # 5. Finalize
    final_insights = [
        Insight(
            insight_id=f"final-{i}",
            title=d.get('insightCore', 'Untitled Insight'),
            score=d.get('score', 0),
            snippet=d.get('reframedProblem'),
            agenticTranscript=d.get('agenticTranscript'),
            verification=d.get('verification')
        ) for i, d in enumerate(top_insights_data)
    ]
    await progress.update(Phase.finalizing, 100)

    return JobResult(version="v2", insights=final_insights)
