from __future__ import annotations
from typing import Dict, Any, List
from pathlib import Path
import json
from synapse.yaotong.models.recipe import Recipe, ProviderCfg
from synapse.yaotong.tooling.base import LocalTool, MCPTool, ToolHandle
from synapse.yaotong.mcp.client_manager import MCPClientManager
from synapse.yaotong.tools.local_retrieval import retrieve_tool
from synapse.yaotong.tools.local_fusion import fusion_compose_tool
from synapse.yaotong.insight import InsightGenerator
from synapse.yaotong.graph import KnowledgeGraphBuilder
from synapse.yaotong.models.note import Note
from synapse.yaotong.note_store import NoteStore

class WorkingMemory(dict):
    def snapshot(self) -> Dict[str, Any]:
        return dict(self)

class LongTermMemory:
    def __init__(self, path: str | Path = "yaotong_memory.json") -> None:
        self.path = Path(path)
        if self.path.exists():
            with self.path.open("r", encoding="utf-8") as f:
                self.data = json.load(f)
        else:
            self.data = {}

    def save_pill(self, goal: str, pills: List[Dict[str, Any]]) -> None:
        self.data.setdefault(goal, [])
        self.data[goal].extend(pills)
        with self.path.open("w", encoding="utf-8") as f:
            json.dump(self.data, f)

    def load_context(self, goal: str) -> List[Dict[str, Any]]:
        if self.path.exists():
            with self.path.open("r", encoding="utf-8") as f:
                self.data = json.load(f)
        return list(self.data.get(goal, []))

class YaoTong:
    def __init__(
        self,
        recipe: Recipe,
        mcp: MCPClientManager | None = None,
        memory_store: LongTermMemory | None = None,
    ):
        self.recipe = recipe
        self.mcp = mcp or MCPClientManager()
        self.memory_store = memory_store or LongTermMemory()
        self.wm: WorkingMemory = WorkingMemory()
        self.tools: Dict[str, ToolHandle] = {}
        self._insight = InsightGenerator()
        self._kg = KnowledgeGraphBuilder()
        self._store = NoteStore()

    async def _resolve_tool(self, logical: str, default_local_fn) -> None:
        cfg: ProviderCfg = self.recipe.providers.get(logical, ProviderCfg(type="local"))
        if cfg.type == "local":
            self.tools[logical] = LocalTool(logical, default_local_fn)
            return
        # MCP-backed
        if cfg.server not in self.mcp._servers:
            await self.mcp.connect(cfg.server)           # stdio by default
            await self.mcp.list_tools(cfg.server)
        self.tools[logical] = MCPTool(cfg.server, cfg.tool or logical, self.mcp)

    async def setup(self) -> None:
        await self._resolve_tool("retrieve", retrieve_tool)
        await self._resolve_tool("fusion_compose", fusion_compose_tool)
        # add others in later sprints (facet.extract, hypothesis.generate/score, verify, graph.merge)

    async def run(self, goal: str) -> Dict[str, Any]:
        self.wm = WorkingMemory()
        self.wm["goal"] = goal
        context = self.memory_store.load_context(goal)
        if context:
            self.wm["context"] = context
        # phase 1: retrieval (respect recipe limits/depth)
        top_k = max(1, int(self.recipe.notes_limit))
        depth = max(1, int(self.recipe.explore_depth))
        out = await self.tools["retrieve"].call({"query": goal, "top_k": top_k, "depth": depth})
        self.wm["hits"] = out.get("hits", [])

        # materialize Note objects; prefer real DB fetch via NoteStore
        note_ids = [str(h.get("note_id", "")) for h in self.wm["hits"] if h.get("note_id")]
        notes: List[Note] = await self._store.get_notes_by_ids(note_ids) if note_ids else []
        # if store returned empty (e.g., DB unavailable), fallback to placeholders
        if not notes and note_ids:
            notes = [
                Note(id=nid, title=f"Note {nid}", content=f"Retrieved hit {nid} for goal: {goal}")
                for nid in note_ids
            ]

        # optional: build knowledge graph per recipe
        graph = None
        if self.recipe.use_graph:
            graph = self._kg.build(notes)
            self.wm["graph"] = graph

        # phase 2: insight generation via class-based generator (replaces direct fusion tool call)
        generated = await self._insight.generate(notes, self.recipe)
        self.wm["pills"] = [g.model_dump() for g in generated]
        self.memory_store.save_pill(goal, self.wm["pills"])
        return {
            "goal": goal,
            "pills": self.wm["pills"],
            "context": self.wm.get("context", []),
            "trace": {"hits": self.wm["hits"], **({"graph": graph} if graph else {})},
        }
