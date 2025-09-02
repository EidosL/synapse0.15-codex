"""
Centralized LLM task-to-model routing for the backend.

This module defines a single source of truth for which model handles which
task, and exposes a helper to route chat-style requests via the Vercel AI
Gateway when configured, with a safe fallback to Gemini.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
import os
import httpx

from ...util.genai_compat import generate_text, embed_texts, embed_texts_sync as _embed_texts_sync
import json


# Single source of truth for model selection per task
TASK_MODEL_MAP: Dict[str, str] = {
    "semanticChunker": "groq/meta/llama-3.1-8b",
    "evaluateNovelty": "groq/meta/llama-3.1-8b",
    "webSearchSummary": "groq/meta/llama-3.1-8b",
    "mindMapExtract": "groq/meta/llama-3.1-8b",
    "generateDivergentQuestion": "deepseek/deepseek-v3.1-thinking",
    "planNextStep": "deepseek/deepseek-v3.1-thinking",
    "generateInsight": "google/gemini-2.5-pro",
    "runSelfEvolution": "google/gemini-2.5-pro",
}

# Tasks that should bypass the gateway and call Google AI API directly
FORCE_GOOGLE_TASKS = {"generateInsight", "runSelfEvolution"}


def get_model_for_task(task_name: str) -> str:
    return TASK_MODEL_MAP.get(task_name, "google/gemini-1.5-flash")


async def route_via_gateway(task_name: str, messages: List[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Route a chat completion through the Vercel AI Gateway (OpenAI-compatible).

    Returns an OpenAI-compatible ChatCompletion-like dict with at least:
    {"choices": [{"message": {"content": str}}]}
    """
    token = os.getenv("VERCEL_AI_GATEWAY_TOKEN")
    base_url = os.getenv("VERCEL_AI_GATEWAY_URL", "").rstrip("/")
    # Normalize base URL: allow users to set with or without '/v1'
    if base_url.endswith("/v1"):
        base_url = base_url[:-3]
    if not token or not base_url:
        raise RuntimeError("Vercel AI Gateway not configured")

    model = get_model_for_task(task_name)
    payload = {"model": model, "messages": messages}
    if options:
        payload.update(options)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        # Optional: enable fallback at gateway level
        "x-fallback-models": "google/gemini-1.5-flash",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{base_url}/v1/chat/completions", json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()


async def route_llm_call(task_name: str, messages: List[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Primary router used by the API layer.

    Tries the Gateway first; if unavailable, falls back to a simple Gemini call by
    concatenating messages into one prompt.
    """
    # Build a single prompt from chat messages
    prompt_parts: List[str] = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if isinstance(content, list):
            text = "\n".join([c if isinstance(c, str) else str(c) for c in content])
        else:
            text = str(content)
        prompt_parts.append(f"{role.upper()}: {text}")
    prompt = "\n\n".join(prompt_parts)

    # For critical tasks, always use Google AI API directly
    if task_name in FORCE_GOOGLE_TASKS:
        text = await generate_text(get_model_for_task(task_name), prompt)
        return {"choices": [{"message": {"content": text}}]}

    # Otherwise, prefer the gateway; if it fails, fall back to Google
    try:
        return await route_via_gateway(task_name, messages, options)
    except Exception:
        text = await generate_text(get_model_for_task(task_name), prompt)
        return {"choices": [{"message": {"content": text}}]}


# --- Convenience helpers used across the backend ---

async def llm_text(task_name: str, prompt: str, temperature: float | None = None) -> str:
    msgs = [
        {"role": "user", "content": prompt},
    ]
    opts = {"temperature": temperature} if temperature is not None else {}
    resp = await route_llm_call(task_name, msgs, opts)
    content = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
    return content if isinstance(content, str) else str(content)


async def llm_json(task_name: str, prompt: str, temperature: float | None = None) -> Any:
    sys = {
        "role": "system",
        "content": "Return ONLY valid JSON. No commentary, no code fences.",
    }
    msgs = [sys, {"role": "user", "content": prompt}]
    opts = {"temperature": temperature} if temperature is not None else {}
    resp = await route_llm_call(task_name, msgs, opts)
    content = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
    text = content if isinstance(content, str) else str(content)
    try:
        return json.loads(text)
    except Exception:
        # Best-effort: strip code fences/backticks and retry
        cleaned = str(text).strip().strip('`')
        try:
            return json.loads(cleaned)
        except Exception:
            raise ValueError(f"LLM did not return valid JSON for task {task_name}.")


async def embed_texts_async(model: str, texts: list[str]) -> list[list[float]]:
    # For now use Google-compatible shim, centralized here for future routing
    return await embed_texts(model, texts)


def embed_texts_sync(model: str, texts: list[str]) -> list[list[float]]:
    return _embed_texts_sync(model, texts)
