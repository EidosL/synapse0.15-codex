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
    for cand_note in candidate_notes:
        source_chunks = [{"noteId": source_note['id'], "text": p} for p in source_note['content'].split('\n\n')[:2]]
        cand_chunks = [{"noteId": cand_note['id'], "text": p} for p in cand_note['content'].split('\n\n')[:2]]
        tasks.append(generate_insight(source_chunks + cand_chunks))

    generated_insights = await asyncio.gather(*tasks)
    insights = [i for i in generated_insights if i and i.get("mode") != "none"]

    for insight in insights:
        insight['score'] = insight.get('eurekaMarkers', {}).get('conviction', 0)

    insights.sort(key=lambda x: x.get('score', 0), reverse=True)
    return insights[:3]

# --- Main Pipeline Orchestrator ---
async def run_full_insight_pipeline(inp: PipelineInput, progress: ProgressReporter) -> JobResult:
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
    if not top_insights_data: raise ValueError("Synthesis engine produced no valid insights.")

    partial_results = [Insight(insight_id=f"temp-{i}", title=d.get('insightCore', 'Untitled Insight'), score=d.get('score', 0)) for i, d in enumerate(top_insights_data)]
    await progress.update(Phase.initial_synthesis, 60, partial=partial_results)

    # 3. Agentic Refinement
    top_insight = top_insights_data[0]
    evidence_texts = [ref['quote'] for ref in top_insight.get('evidenceRefs', []) if 'quote' in ref]

    refined_transcript = await maybe_auto_deepen(
        tier='pro', topic=source_note.get('title', ''),
        insight_core=top_insight.get('insightCore', ''), evidence_texts=evidence_texts
    )

    if refined_transcript:
        top_insight['agenticTranscript'] = refined_transcript

    await progress.update(Phase.agent_refinement, 90)

    # 4. Finalize
    final_insights = [
        Insight(
            insight_id=f"final-{i}",
            title=d.get('insightCore', 'Untitled Insight'),
            score=d.get('score', 0),
            snippet=d.get('reframedProblem'),
            agenticTranscript=d.get('agenticTranscript')
        ) for i, d in enumerate(top_insights_data)
    ]
    await progress.update(Phase.finalizing, 100)

    return JobResult(version="v2", insights=final_insights)
