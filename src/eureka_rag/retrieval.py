import os
import json
from typing import List, Dict, Any, Optional

import google.generativeai as genai

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
    """
    Generates search queries based on a note's content.
    """
    topic = note_title.strip() or note_content[:120]
    cheap = cheap_expand_queries(topic)

    API_KEY = os.getenv("GOOGLE_API_KEY")
    if not API_KEY:
        return list(cheap.values())[:max_queries]

    genai.configure(api_key=API_KEY)
    model = genai.GenerativeModel('gemini-1.5-flash')

    prompt = f"""Return JSON with ANY subset of keys: {', '.join(RELATIONS)}. Each value must be a concise search query derived from:
Title: {note_title}
Content: {note_content[:1000]}"""

    schema = {
        "type": "object",
        "properties": {key: {"type": "string"} for key in RELATIONS},
        "required": []
    }

    try:
        response = await model.generate_content_async(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": schema,
            },
        )
        obj = json.loads(response.text)
        # Combine LLM-generated queries with the cheap ones, ensuring no duplicates
        all_queries = list(dict.fromkeys([*list(obj.values()), *list(cheap.values())]))
        return all_queries[:max_queries]
    except Exception as e:
        print(f"Error generating search queries, using fallback: {e}")
        return list(cheap.values())[:max_queries]


def tokenize(s: str) -> List[str]:
    """
    Simple tokenizer that splits on whitespace and removes punctuation.
    """
    return "".join(c for c in s.lower() if c.isalnum() or c.isspace()).split()

def lexical_rank_notes(queries: List[str], notes: List[Dict[str, Any]], top_n: int = 40) -> List[str]:
    """
    Ranks notes based on lexical similarity (term frequency) with queries.
    """
    q_terms = {term for query in queries for term in tokenize(query)}
    scored = []
    for n in notes:
        text = f"{n.get('title', '')} {n.get('content', '')}"
        toks = tokenize(text)
        tf = {term: toks.count(term) for term in q_terms}
        score = sum(tf.values())
        scored.append({'id': n['id'], 'score': score})

    scored.sort(key=lambda x: x['score'], reverse=True)
    return [x['id'] for x in scored[:top_n]]

def rrf(ranked_lists: List[List[str]], k: int = 60) -> List[str]:
    """
    Fuses multiple ranked lists using Reciprocal Rank Fusion.
    """
    scores = {}
    for lst in ranked_lists:
        for i, doc_id in enumerate(lst):
            scores[doc_id] = scores.get(doc_id, 0) + 1 / (k + i + 1)

    sorted_docs = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    return [doc_id for doc_id, _ in sorted_docs]

import numpy as np
from scipy.spatial.distance import cdist
from .embedder import Embedder

class VectorStore:
    def __init__(self, notes: List[Dict[str, Any]], embedder: Embedder):
        self.notes = notes
        self.embedder = embedder
        self.chunks = []
        self.embeddings = []

        # Create and embed chunks from all notes
        all_chunks_to_embed = []
        for note in self.notes:
            note_id = note['id']
            # Simple paragraph-based chunking
            paragraphs = note.get('content', '').split('\n\n')
            for i, p_text in enumerate(paragraphs):
                if p_text.strip():
                    chunk = {'id': f"{note_id}:{i}", 'note_id': note_id, 'text': p_text.strip()}
                    self.chunks.append(chunk)
                    all_chunks_to_embed.append(chunk['text'])

        if all_chunks_to_embed:
            raw_embeddings = self.embedder.model.encode(all_chunks_to_embed, convert_to_tensor=False)
            self.embeddings = np.array(raw_embeddings)

    def find_nearest(self, query_embedding: np.ndarray, top_k: int, exclude_note_id: str) -> List[Dict[str, Any]]:
        if not self.embeddings.any() or not query_embedding.any():
            return []

        # Ensure query_embedding is 2D
        query_embedding = np.atleast_2d(query_embedding)

        # Calculate cosine similarity (1 - cosine distance)
        distances = cdist(query_embedding, self.embeddings, 'cosine')[0]

        # Get top_k indices, sorted by similarity (ascending distance)
        nearest_indices = np.argsort(distances)[:top_k * 2] # Get more to filter

        results = []
        seen_note_ids = set()
        for idx in nearest_indices:
            chunk = self.chunks[idx]
            if chunk['note_id'] != exclude_note_id and chunk['note_id'] not in seen_note_ids:
                results.append({
                    'note_id': chunk['note_id'],
                    'score': 1 - distances[idx]
                })
                seen_note_ids.add(chunk['note_id'])
            if len(results) >= top_k:
                break

        return results

async def retrieve_candidate_notes(
    queries: List[str],
    vector_store: VectorStore,
    all_notes: List[Dict[str, Any]],
    exclude_note_id: str,
    top_k: int = 10
) -> List[str]:
    """
    Retrieves candidate notes using a hybrid lexical and vector search approach.
    """
    if not queries or not all_notes:
        return []

    # 1. Lexical Ranking
    lex_ranked_ids = lexical_rank_notes(queries, all_notes, top_n=40)

    # 2. Vector Ranking
    vec_lists = []
    query_embeddings = vector_store.embedder.model.encode(queries, convert_to_tensor=False)

    for embedding in query_embeddings:
        matches = vector_store.find_nearest(embedding, top_k, exclude_note_id)
        # Get unique note IDs from the matches
        vec_lists.append(list(dict.fromkeys([m['note_id'] for m in matches])))

    # 3. Fuse with RRF
    fused = rrf([lex_ranked_ids] + vec_lists)

    # 4. Filter out the excluded note
    final_ids = [note_id for note_id in fused if note_id != exclude_note_id]

    return final_ids[:top_k]
