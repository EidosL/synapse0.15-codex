import os
import json
import uuid
from typing import List, Dict, Any
import numpy as np
import google.generativeai as genai
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.vector_index_manager import vector_index_manager
from src.util.genai_compat import embed_texts_sync
from src.database import crud

# --- Query Generation ---

RELATIONS = ['Contradiction', 'PracticalApplication', 'HistoricalAnalogy', 'ProblemToSolution', 'DeepSimilarity', 'Mechanism', 'Boundary', 'TradeOff']

def cheap_expand_queries(topic: str) -> Dict[str, str]:
    return {
        'Contradiction': f"{topic} limitation counterexample",
        'PracticalApplication': f"{topic} how to apply implementation",
        'HistoricalAnalogy': f"{topic} historical precedent analogous case",
        'ProblemToSolution': f"{topic} bottleneck solution workaround",
        'DeepSimilarity': f"{topic} pattern structure isomorphic",
        'Mechanism': f"{topic} mechanism pathway causes via",
        'Boundary': f"{topic} only if fails when under condition",
        'TradeOff': f"{topic} trade-off at the cost of diminishing returns",
    }

async def generate_search_queries(note_title: str, note_content: str, max_queries: int) -> List[str]:
    """Generates search queries based on a note's content."""
    topic = note_title.strip() or note_content[:120]
    cheap = cheap_expand_queries(topic)
    API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not API_KEY: return list(cheap.values())[:max_queries]
    genai.configure(api_key=API_KEY)
    model = genai.GenerativeModel('gemini-1.5-flash')
    prompt = f"""Return JSON with ANY subset of keys: {', '.join(RELATIONS)}. Each value must be a concise search query derived from:\nTitle: {note_title}\nContent: {note_content[:1000]}"""
    schema = {"type": "object", "properties": {key: {"type": "string"} for key in RELATIONS}, "required": []}
    try:
        response = await model.generate_content_async(prompt, generation_config={"response_mime_type": "application/json", "response_schema": schema})
        obj = json.loads(response.text)
        all_queries = list(dict.fromkeys([*list(obj.values()), *list(cheap.values())]))
        return all_queries[:max_queries]
    except Exception as e:
        print(f"Error generating search queries, using fallback: {e}")
        return list(cheap.values())[:max_queries]

# --- Lexical and Vector Search ---

def tokenize(s: str) -> List[str]:
    """Simple tokenizer that splits on whitespace and removes punctuation."""
    return "".join(c for c in s.lower() if c.isalnum() or c.isspace()).split()

def lexical_rank_notes(queries: List[str], notes: List[Dict[str, Any]], top_n: int = 40) -> List[str]:
    """Ranks notes based on lexical similarity (term frequency) with queries."""
    q_terms = {term for query in queries for term in tokenize(query)}
    scored = [{'id': n['id'], 'score': sum(tokenize(f"{n.get('title', '')} {n.get('content', '')}").count(term) for term in q_terms)} for n in notes]
    scored.sort(key=lambda x: x['score'], reverse=True)
    return [x['id'] for x in scored[:top_n]]

async def vector_rank_notes(queries: List[str], db: AsyncSession, exclude_note_id: str, top_k: int) -> List[str]:
    """Ranks notes based on vector similarity using the global FAISS index."""
    if not await vector_index_manager.index.ntotal: return []

    # Use cloud embeddings for queries to match index space
    query_embeddings = embed_texts_sync('text-embedding-004', queries)
    # Filter empty/invalid embeddings and enforce consistent dimensionality
    qv = [np.asarray(e, dtype=float).ravel() for e in query_embeddings if isinstance(e, list) and len(e) > 0]
    if not qv:
        return []
    dims = [v.size for v in qv]
    from collections import Counter
    target_dim, _ = Counter(dims).most_common(1)[0]
    qv = [v for v in qv if v.size == target_dim]
    if not qv:
        return []
    avg_query_vector = np.mean(np.vstack(qv), axis=0).reshape(1, -1)

    # Search for similar chunks
    search_results = await vector_index_manager.search(query_vector=avg_query_vector, k=top_k * 2) # Get more to filter

    # Get the note IDs for the resulting chunks
    chunk_ids = [uuid.UUID(res[0]) for res in search_results]
    chunk_to_note_map = await crud.get_note_ids_for_chunk_ids(db, chunk_ids=chunk_ids)

    # Create a ranked list of unique note IDs
    ranked_note_ids = []
    seen_note_ids = set()
    for chunk_id_str, _ in search_results:
        chunk_id = uuid.UUID(chunk_id_str)
        note_id = chunk_to_note_map.get(chunk_id)
        if note_id and str(note_id) != exclude_note_id and note_id not in seen_note_ids:
            ranked_note_ids.append(str(note_id))
            seen_note_ids.add(note_id)

    return ranked_note_ids[:top_k]


# --- Fusion and Final Retrieval ---

def rrf(ranked_lists: List[List[str]], k: int = 60) -> List[str]:
    """Fuses multiple ranked lists using Reciprocal Rank Fusion."""
    scores = {}
    for lst in ranked_lists:
        for i, doc_id in enumerate(lst):
            scores[doc_id] = scores.get(doc_id, 0) + 1 / (k + i + 1)
    sorted_docs = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    return [doc_id for doc_id, _ in sorted_docs]

async def retrieve_candidate_notes(
    queries: List[str],
    db: AsyncSession,
    all_notes: List[Dict[str, Any]],
    exclude_note_id: str,
    top_k: int = 10
) -> List[str]:
    """
    Retrieves candidate notes using a hybrid lexical and vector search approach.
    """
    if not queries or not all_notes: return []

    # 1. Lexical Ranking
    lex_ranked_ids = lexical_rank_notes(queries, all_notes, top_n=40)

    # 2. Vector Ranking
    vec_ranked_ids = await vector_rank_notes(queries, db, exclude_note_id, top_k=20)

    # 3. Fuse with RRF
    fused = rrf([lex_ranked_ids, vec_ranked_ids])

    # 4. Filter out the excluded note
    final_ids = [note_id for note_id in fused if note_id != exclude_note_id]

    return final_ids[:top_k]
