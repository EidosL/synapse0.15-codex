from __future__ import annotations
from typing import Dict, Any, List
from pathlib import Path
import json
from synapse.yaotong.models.recipe import Recipe, ProviderCfg
from synapse.yaotong.tooling.base import LocalTool, MCPTool, ToolHandle
from synapse.yaotong.mcp.client_manager import MCPClientManager
from synapse.yaotong.tools.local_retrieval import retrieve_tool
from synapse.yaotong.tools.local_fusion import fusion_compose_tool

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
        # phase 1: retrieval (mocked local tool by default)
        out = await self.tools["retrieve"].call({"query": goal, "top_k": 10})
        self.wm["hits"] = out.get("hits", [])
        # phase 2: (placeholder) hypotheses
        hyps = [{
            "id": "h1",
            "statement": f"Integrate key ideas about: {goal}",
            "facets": ["f1","f2"], "conflicts": [],
            "supportScore": 0.8, "noveltyScore": 0.5, "coherenceScore": 0.7
        }]
        # phase 3: fusion compose
        pills = await self.tools["fusion_compose"].call({"hypotheses": hyps})
        self.wm["pills"] = pills.get("pills", [])
        self.memory_store.save_pill(goal, self.wm["pills"])
        return {"goal": goal, "pills": self.wm["pills"], "context": self.wm.get("context", []), "trace": {"hits": self.wm["hits"]}}
