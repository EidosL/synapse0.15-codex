from __future__ import annotations

import os
from typing import Dict, List

from src.utils import core_web_search
from src.agentscope_app.telemetry import trace


@trace("synapse.tools.web_search")
async def search_web(query: str, k: int = 3) -> List[Dict[str, str]]:
    """
    SERP/HTTP search tool with env-based switch.
    Returns [] when SERPAPI_API_KEY is not configured (disabled state).
    """
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        return []
    return await core_web_search(query, k)
