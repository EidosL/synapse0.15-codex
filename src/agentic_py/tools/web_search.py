import os
from typing import List, Dict

from .base import Tool
from ..models import PlanStep, ToolResult
from ...utils import core_web_search
from ...util.genai_compat import generate_text

class WebSearchTool(Tool):
    """
    A tool for searching the web and summarizing the results.
    """
    @property
    def name(self) -> str:
        return 'web_search'

    async def execute(self, step: PlanStep) -> ToolResult:
        """
        Performs a web search, summarizes the results, and returns a ToolResult.
        """
        hits = await self._search(step.message, 5)
        if not hits:
            return ToolResult(action=self.name, ok=True, content="No results found.", citations=[])

        bullets = "\n".join([f"• {h['title']}: {h['snippet']}" for h in hits])

        summary = await self._summarize(step.expected, bullets)

        return ToolResult(
            action=self.name,
            ok=True,
            content=f"WEB_SUMMARY:\n{summary or bullets}",
            citations=[{"url": h['url']} for h in hits]
        )

    async def _search(self, q: str, k: int) -> List[Dict[str, str]]:
        """
        Private method to perform the core web search.
        """
        if not q:
            return []
        print(f"--- TOOL: WEB SEARCH for '{q}' ---")
        results = await core_web_search(q, k)
        print(f"--- Found {len(results)} results. ---")
        return results

    async def _summarize(self, task_description: str, text: str) -> str:
        """
        Private method to summarize text using a generative model.
        """
        prompt = f'Summarize key facts useful for: "{task_description}". Use only these bullets, no new claims.\n{text}'

        try:
            # The compatibility layer handles the API key and client setup.
            return await generate_text('gemini-1.5-flash', prompt)
        except Exception as e:
            print(f"An error occurred during summarization: {e}")
            return text # Fallback to original text on error
