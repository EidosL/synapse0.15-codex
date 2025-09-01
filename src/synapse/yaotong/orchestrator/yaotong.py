from __future__ import annotations
from typing import Dict, Any
from synapse.yaotong.models.recipe import Recipe, ProviderCfg
from synapse.yaotong.tooling.base import LocalTool, MCPTool, ToolHandle
from synapse.yaotong.mcp.client_manager import MCPClientManager
from synapse.yaotong.tools.local_retrieval import retrieve_tool
from synapse.yaotong.tools.local_fusion import fusion_compose_tool
from synapse.yaotong.tools.graph_builder import graph_builder_tool

class WorkingMemory(dict):
    def snapshot(self) -> Dict[str, Any]:
        return dict(self)

class YaoTong:
    def __init__(self, recipe: Recipe, mcp: MCPClientManager | None = None):
        self.recipe = recipe
        self.mcp = mcp or MCPClientManager()
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
        await self._resolve_tool("graph_build", graph_builder_tool)
        # add others in later sprints (facet.extract, hypothesis.generate/score, verify, graph.merge)

    async def run(self, goal: str, use_graph: bool = False) -> Dict[str, Any]:
        self.wm["goal"] = goal
        # phase 1: retrieval (mocked local tool by default)
        out = await self.tools["retrieve"].call({"query": goal, "top_k": 10})
        self.wm["hits"] = out.get("hits", [])
        if use_graph:
            graph = await self.tools["graph_build"].call({"notes": []})
            self.wm["graph"] = graph
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
        trace = {"hits": self.wm["hits"]}
        if use_graph:
            trace["graph"] = self.wm["graph"]
        return {"goal": goal, "pills": self.wm["pills"], "trace": trace}
