from typing import List, Dict, Any, Optional
import json
import os
import google.generativeai as genai

# This import is tricky. It assumes the server file is importable and
# doesn't create circular dependencies. This is generally okay for a
# simple, single-file server setup like this one.
# A more complex app might use dependency injection.
from server import core_web_search
from .models import MindMap


class WebSearchTool:
    """
    A tool for searching the web, wrapping the core search logic from the server.
    """
    async def search(self, q: str, k: int) -> List[Dict[str, str]]:
        """
        Performs a web search and returns a list of results.
        """
        if not q:
            return []

        print(f"--- TOOL: WEB SEARCH for '{q}' ---")
        results = await core_web_search(q, k)
        print(f"--- Found {len(results)} results. ---")
        return results

# --- Mind Map Tool ---

MAP_SCHEMA = {
    "type": "object", "properties": {
        "nodes": { "type": "array", "items": { "type": "object", "properties": { "id": {"type": "string"}, "label": {"type": "string"}, "kind": {"type": "string"}, }, "required": ["id", "label", "kind"], }, },
        "edges": { "type": "array", "items": { "type": "object", "properties": { "s": {"type": "string"}, "t": {"type": "string"}, "rel": {"type": "string"}, }, "required": ["s", "t", "rel"], }, },
        "summaries": {"type": "array", "items": {"type": "string"}},
    }, "required": ["nodes", "edges", "summaries"],
}

async def build_mind_map_from_transcript(transcript: str) -> Optional[MindMap]:
    API_KEY = os.getenv("GOOGLE_API_KEY")
    if not API_KEY: return None

    genai.configure(api_key=API_KEY)
    model = genai.GenerativeModel('gemini-1.5-flash')

    prompt = "Extract a MIND MAP from the transcript.\nReturn JSON with nodes (entity|concept|claim), edges (s,t,rel), and 1–3 short summaries.\nBe faithful; no hallucinations."

    try:
        response = await model.generate_content_async(
            f"{prompt}\n---\n{transcript[:6000]}\n---",
            generation_config={ "response_mime_type": "application/json", "response_schema": MAP_SCHEMA, "temperature": 0.2, },
        )
        return MindMap(**json.loads(response.text))
    except Exception as e:
        print(f"An error occurred during mind map generation: {e}")
        return None

class MindMapTool:
    def __init__(self, storage_path: str = "mindmaps.json", session_id: str = "synapse-session"):
        self.storage_path = storage_path
        self.session_id = session_id
        self.graphs: Dict[str, Dict[str, List[Any]]] = {}
        self._load()

    def _load(self):
        if os.path.exists(self.storage_path):
            try:
                with open(self.storage_path, 'r', encoding='utf-8') as f:
                    self.graphs = json.loads(f.read())
            except (json.JSONDecodeError, FileNotFoundError):
                self.graphs = {}

    def _persist(self):
        with open(self.storage_path, 'w', encoding='utf-8') as f:
            json.dump(self.graphs, f, indent=2)

    async def update(self, transcript: str):
        print("--- TOOL: MIND MAP UPDATE ---")
        mind_map = await build_mind_map_from_transcript(transcript)
        if mind_map:
            existing_graph = self.graphs.get(self.session_id, {"nodes": [], "edges": [], "summaries": []})

            node_map = {n['id']: n for n in existing_graph['nodes']}
            for node in mind_map.nodes:
                if node.id not in node_map:
                    existing_graph['nodes'].append(node.dict())

            edge_set = {f"{e['s']}->{e['t']}:{e['rel']}" for e in existing_graph['edges']}
            for edge in mind_map.edges:
                key = f"{edge.s}->{edge.t}:{edge.rel}"
                if key not in edge_set:
                    existing_graph['edges'].append(edge.dict())

            existing_graph['summaries'] = mind_map.summaries
            self.graphs[self.session_id] = existing_graph
            self._persist()
        print(f"--- Mind map updated. {len(self.graphs.get(self.session_id, {}).get('nodes', []))} nodes total. ---")

    async def answer(self, query: str) -> str:
        print(f"--- TOOL: MIND MAP QUERY for '{query}' ---")
        graph = self.graphs.get(self.session_id)
        if not graph: return "No graph found for this session."

        q = query.lower()
        paths = set()
        node_map = {n['id']: n for n in graph['nodes']}

        for node in graph['nodes']:
            if q in node['label'].lower():
                for edge in graph['edges']:
                    if edge['s'] == node['id'] or edge['t'] == node['id']:
                        s_label = node_map.get(edge['s'], {}).get('label', edge['s'])
                        t_label = node_map.get(edge['t'], {}).get('label', edge['t'])
                        paths.add(f"{s_label} -[{edge['rel']}]-> {t_label}")

        if not paths:
            summaries = graph.get('summaries', ["No summary available."])
            return summaries[0] if summaries else "No relevant paths or summary found."

        return "\n".join(list(paths))
