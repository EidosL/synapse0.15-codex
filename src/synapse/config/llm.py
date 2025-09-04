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
import json
import time

try:
    # Prefer AgentScope ChatModel when available
    from ..yaotong.agents.as_utils import get_chat_model  # type: ignore
except Exception:
    get_chat_model = None  # type: ignore

from src.agentscope_app.metrics.usage import record_call


# Single source of truth for model selection per task
TASK_MODEL_MAP: Dict[str, str] = {
    "semanticChunker": "groq/meta/llama-3.1-8b",
    "evaluateNovelty": "deepseek/deepseek-v3.1-thinking",
    "webSearchSummary": "groq/meta/llama-3.1-8b",
    "mindMapExtract": "groq/meta/llama-3.1-8b",
    "generateDivergentQuestion": "deepseek/deepseek-v3.1-thinking",
    "planNextStep": "deepseek/deepseek-v3.1-thinking",
    "generateInsight": "google/gemini-2.5-pro",
    "runSelfEvolution": "google/gemini-2.5-pro",
    # Distillation tasks → cheaper DeepSeek via AI Gateway
    "templateSynthesis": "deepseek/deepseek-v3.1-thinking",
    "refineSection": "deepseek/deepseek-v3.1-thinking",
    # Retrieval helpers
    "generateSearchQueries": "deepseek/deepseek-v3.1-thinking",
    # Planner/Prescriber
    "prescribe": "deepseek/deepseek-v3.1-thinking",
      # Ranking / critique
    "counterInsight": "deepseek/deepseek-v3.1-thinking",
}

# Tasks that should prefer direct Gemini (Google Cloud credit) for heavy work
HEAVY_TASKS = set(os.getenv("LLM_HEAVY_TASKS", "generateInsight,runSelfEvolution").split(","))

# Distillation tasks: prefer AI Gateway + DeepSeek, skip AgentScope path
DISTILLATION_TASKS = {"templateSynthesis", "refineSection"}


def get_model_for_task(task_name: str) -> str:
    # Allow per-task override via env: LLM_MODEL_<TASK_NAME>
    # Example: LLM_MODEL_refineSection=deepseek/deepseek-v3.1
    env_key = f"LLM_MODEL_{task_name}"
    # Also try uppercased normalized variant for safety
    import re
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", task_name).upper()
    env_key_norm = f"LLM_MODEL_{normalized}"
    return (
        os.getenv(env_key)
        or os.getenv(env_key_norm)
        or TASK_MODEL_MAP.get(task_name, "google/gemini-1.5-flash")
    )


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

    # For distillation tasks, prefer gateway model directly (e.g., DeepSeek)
    if task_name in DISTILLATION_TASKS:
        try:
            start = time.perf_counter()
            resp = await route_via_gateway(task_name, messages, options or {})
            # Record simple usage estimate
            try:
                prompt_len = sum(len(str(m.get("content", ""))) for m in messages)
                record_call(provider="gateway", model=get_model_for_task(task_name), input_tokens=prompt_len//4, output_tokens=None, time_sec=time.perf_counter() - start)
            except Exception:
                pass
            return resp
        except Exception:
            # Fall through to generic routing
            pass

    # 0) Try AgentScope ChatModel when available
    start = time.perf_counter()
    if get_chat_model is not None:
        try:
            prefer = "gemini" if task_name in HEAVY_TASKS else os.getenv("LLM_DEFAULT_PROVIDER", "gemini")
            model = get_chat_model(prefer=prefer, stream=False)
            if model is not None:
                res = await model(messages, **(options or {}))
                # Extract concatenated text blocks
                parts = []
                for blk in getattr(res, "content", []) or []:
                    try:
                        t = blk.get("text") if isinstance(blk, dict) else getattr(blk, "text", None)
                        if t:
                            parts.append(str(t))
                    except Exception:
                        continue
                text = "\n".join(parts).strip()
                # Usage metrics (AgentScope provides tokens/time on supported providers)
                try:
                    usage = getattr(res, "usage", None)
                    record_call(provider=prefer, model=get_model_for_task(task_name), input_tokens=getattr(usage, "input_tokens", None), output_tokens=getattr(usage, "output_tokens", None), time_sec=getattr(usage, "time", None))
                except Exception:
                    record_call(provider=prefer, model=get_model_for_task(task_name), input_tokens=None, output_tokens=None, time_sec=time.perf_counter() - start)
                return {"choices": [{"message": {"content": text}}]}
        except Exception:
            # fall through to other strategies
            pass

    # 1) Prefer the Vercel AI Gateway when configured
    try:
        resp = await route_via_gateway(task_name, messages, options)
        # Approximate usage (tokens unknown) by prompt length
        approx_in = sum(len(str(m.get("content", ""))) for m in messages) // 4
        record_call(provider="gateway", model=get_model_for_task(task_name), input_tokens=approx_in, output_tokens=None, time_sec=time.perf_counter() - start)
        return resp
    except Exception:
        pass

    # 2) Try Hugging Face Inference API for light tasks (optional)
    hf_token = os.getenv("HF_API_TOKEN")
    hf_model = os.getenv("HF_TEXT_MODEL")
    if hf_token and hf_model and task_name not in HEAVY_TASKS:
        try:
            text = await route_via_huggingface(prompt, hf_model, hf_token, options or {})
            record_call(provider="huggingface", model=hf_model, input_tokens=len(prompt)//4, output_tokens=None, time_sec=time.perf_counter() - start)
            return {"choices": [{"message": {"content": text}}]}
        except Exception:
            pass

    # 3) Fallback to direct Google (legacy util)
    from ...util.genai_compat import generate_text  # lazy import
    text = await generate_text(get_model_for_task(task_name), prompt)
    record_call(provider="google-api", model=get_model_for_task(task_name), input_tokens=len(prompt)//4, output_tokens=None, time_sec=time.perf_counter() - start)
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
    # Robust JSON parsing with backtick fence cleanup
    for candidate in (text, str(text).strip().strip('`')):
        try:
            return json.loads(candidate)
        except Exception:
            continue
    raise ValueError(f"LLM did not return valid JSON for task {task_name}.")


# Structured output (Pydantic) helper for AgentScope-first routing
async def llm_structured(task_name: str, messages: List[Dict[str, Any]], structured_model: Any, options: Optional[Dict[str, Any]] = None) -> Any:
    start = time.perf_counter()
    # Distillation tasks: use llm_text JSON fallback path to ensure DeepSeek via gateway
    if task_name in DISTILLATION_TASKS:
        text = await llm_text(task_name, "Return ONLY valid JSON for: \n" + json.dumps({"messages": messages}), temperature=options.get("temperature") if options else None)
        return structured_model.model_validate_json(text)
    if get_chat_model is not None:
        try:
            prefer = "gemini" if task_name in HEAVY_TASKS else os.getenv("LLM_DEFAULT_PROVIDER", "gemini")
            model = get_chat_model(prefer=prefer, stream=False)
            if model is not None:
                res = await model(messages, structured_model=structured_model, **(options or {}))
                meta = getattr(res, "metadata", None)
                try:
                    usage = getattr(res, "usage", None)
                    record_call(prefer, get_model_for_task(task_name), getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None), getattr(usage, "time", None))
                except Exception:
                    record_call(prefer, get_model_for_task(task_name), None, None, time.perf_counter() - start)
                if meta is not None:
                    return structured_model.model_validate(meta)
        except Exception:
            pass
    # Fallback: ask for JSON and parse
    text = await llm_text(task_name, "Return ONLY valid JSON for: \n" + json.dumps({"messages": messages}), temperature=options.get("temperature") if options else None)
    return structured_model.model_validate_json(text)


async def route_via_huggingface(prompt: str, model: str, token: str, options: Dict[str, Any]) -> str:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {"inputs": prompt, "parameters": {k: v for k, v in (options or {}).items() if k in ("temperature", "max_new_tokens")} }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"https://api-inference.huggingface.co/models/{model}", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list) and data and "generated_text" in data[0]:
            return str(data[0]["generated_text"]) or ""
        if isinstance(data, dict) and "generated_text" in data:
            return str(data["generated_text"]) or ""
        # Some models return text under different keys; last resort stringify
        return str(data)


async def embed_texts_async(model: str, texts: list[str]) -> list[list[float]]:
    # For now use Google-compatible shim, centralized here for future routing
    from ...util.genai_compat import embed_texts
    return await embed_texts(model, texts)


def embed_texts_sync(model: str, texts: list[str]) -> list[list[float]]:
    from ...util.genai_compat import embed_texts_sync as _sync
    return _sync(model, texts)
