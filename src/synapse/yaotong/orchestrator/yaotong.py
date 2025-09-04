from __future__ import annotations
from typing import Dict, Any, List
from pathlib import Path
import os
import json
from ..models.recipe import Recipe, ProviderCfg
from ..tooling.base import LocalTool, MCPTool, ToolHandle
from ..mcp.client_manager import MCPClientManager
from ..tools.local_retrieval import retrieve_tool
from ..tools.local_fusion import fusion_compose_tool
from ..insight import InsightGenerator
from ..graph import KnowledgeGraphBuilder
from ..models.note import Note
from ..note_store import NoteStore
from ..agents.prescriber import prescribe, Prescription
from ..agents.planner import build_plan
from ..journal import Journal
from src.agentscope_app.telemetry import trace
from ..agents.verifier_agent import self_evolve_and_verify

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

    @trace("yaotong.run")
    async def run(self, goal: str, prescription_override: Prescription | None = None) -> Dict[str, Any]:
        self.wm = WorkingMemory()
        self.wm["goal"] = goal
        journal = Journal(title=f"YaoTong Run: {goal}")
        context = self.memory_store.load_context(goal)
        if context:
            self.wm["context"] = context
            journal.add("Loaded Context", f"Items: {len(context)}")

        # prescriber + planner
        caps = {"faiss": True, "serp": bool(os.getenv("SERPAPI_API_KEY")), "llm": True}
        rx = prescription_override or (await prescribe(goal, project_capabilities=caps, journal=journal))
        plan = await build_plan(rx)
        self.wm["prescription"] = rx.model_dump()
        self.wm["plan"] = [s.model_dump() for s in plan.steps]
        journal.add("Prescription", str(self.wm["prescription"]))
        journal.add("Plan", "\n".join([f"- {s['name']}: {s['args']}" for s in self.wm["plan"]]))
        # phase 1: retrieval (respect recipe limits/depth)
        top_k = max(1, int(self.recipe.notes_limit))
        depth = max(1, int(self.recipe.explore_depth))
        out = await self.tools["retrieve"].call({"query": goal, "top_k": top_k, "depth": depth})
        self.wm["hits"] = out.get("hits", [])
        journal.add("Retrieval", f"Hits: {len(self.wm['hits'])}")

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
            journal.add("Knowledge Graph", f"Nodes: {len(graph.get('nodes', []))}")

        # phase 2: insight generation via class-based generator (replaces direct fusion tool call)
        # honor prescription toggles by adjusting a working recipe
        from ..models.recipe import Recipe
        working_recipe = Recipe(**self.recipe.model_dump())
        if not rx.toggles.get("llm", True):
            working_recipe.model = ""  # disable LLM path in InsightGenerator
        generated = await self._insight.generate(notes, working_recipe)
        self.wm["pills"] = [g.model_dump() for g in generated]
        self.memory_store.save_pill(goal, self.wm["pills"])
        journal.add("Insights", f"Count: {len(self.wm['pills'])}")

        # phase 3: verification + self-evolution (if enabled by prescription)
        if rx.verification.get("enabled") and self.wm["pills"]:
            top = self.wm["pills"][0]
            iterations = int(rx.verification.get("iterations") or max(1, int(self.recipe.explore_depth)))
            max_sites = int(rx.verification.get("max_sites", 3))
            query = goal
            hypotheses = []
            try:
                hypotheses = [{"statement": h} for h in top.get("hypotheses", [])] if isinstance(top.get("hypotheses"), list) else []
            except Exception:
                hypotheses = []
            vres = await self_evolve_and_verify(
                insight_text=top.get("core") or top.get("title") or "",
                hypotheses=hypotheses,
                query=query,
                iterations=iterations,
                web_enabled=True,
                max_sites=max_sites,
            )
            self.wm["verification"] = vres
            journal.add("Verifier", f"Final verdict: {str(vres.get('final_verdict',{}).get('verdict','n/a'))}")
        # optionally persist journal
        try:
            path = journal.save()
            self.wm["journal_path"] = path
        except Exception:
            pass
        return {
            "goal": goal,
            "pills": self.wm["pills"],
            "context": self.wm.get("context", []),
            "trace": {"hits": self.wm["hits"], **({"graph": graph} if graph else {})},
            "prescription": self.wm.get("prescription"),
            "plan": self.wm.get("plan"),
            "journal": self.wm.get("journal_path"),
        }
