import httpx
import os
from typing import List, Dict

async def core_web_search(q: str, k: int) -> List[Dict[str, str]]:
    """
    Performs a web search using SerpAPI and returns a list of results.
    """
    api_key = os.environ.get("SERPAPI_API_KEY")
    if not api_key:
        print("Warning: SERPAPI_API_KEY not set. Web search will return no results.")
        return []
    params = { "engine": "google", "q": q, "num": str(k), "api_key": api_key, "google_domain": "google.com", "gl": "us", "hl": "en" }
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("https://serpapi.com/search", params=params)
            response.raise_for_status()
            data = response.json()
            results = data.get("organic_results", [])
            return [ {"title": r.get("title", "Untitled"), "snippet": r.get("snippet", ""), "url": r.get("link", "")} for r in results if r.get("link") ][:k]
    except Exception as e:
        print(f"An error occurred during web search: {e}")
        return []
