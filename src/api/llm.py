from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any, Dict, List, Optional

from src.synapse.config.llm import route_llm_call, embed_texts_async
from src.synapse.config.llm import get_model_for_task
import os
import json
import httpx


router = APIRouter(prefix="/api/llm", tags=["llm"])


class ChatMessage(BaseModel):
    role: str
    content: Any


class RouteRequest(BaseModel):
    taskName: str
    messages: List[ChatMessage]
    options: Optional[Dict[str, Any]] = None


@router.post("/route")
async def route(req: RouteRequest) -> Dict[str, Any]:
    try:
        result = await route_llm_call(req.taskName, [m.model_dump() for m in req.messages], req.options)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class EmbedRequest(BaseModel):
    model: str = "text-embedding-004"
    texts: List[str]


@router.post("/embed")
async def embed(req: EmbedRequest) -> Dict[str, Any]:
    try:
        vectors = await embed_texts_async(req.model, req.texts)
        return {"model": req.model, "vectors": vectors}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class StreamRouteRequest(BaseModel):
    taskName: str
    messages: List[ChatMessage]
    options: Optional[Dict[str, Any]] = None


@router.post("/stream")
async def stream_route(req: StreamRouteRequest):
    """
    Streams LLM output as normalized SSE tokens.

    Event payloads are JSON lines under 'data:' with the shape:
      { "token": string }  for incremental pieces
      { "done": true, "text": string }  once complete

    This normalizes provider-specific SSE to a simple token stream.
    """
    token = os.getenv("VERCEL_AI_GATEWAY_TOKEN")
    base_url = os.getenv("VERCEL_AI_GATEWAY_URL", "").rstrip("/")
    if base_url.endswith("/v1"):
        base_url = base_url[:-3]

    async def event_gen_gateway():
        model = get_model_for_task(req.taskName)
        payload: Dict[str, Any] = {"model": model, "messages": [m.model_dump() for m in req.messages], "stream": True}
        if req.options:
            # Avoid overriding 'stream' if passed by caller
            payload.update({k: v for k, v in req.options.items() if k != "stream"})

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "x-fallback-models": "google/gemini-1.5-flash",
        }

        full_text = []
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", f"{base_url}/v1/chat/completions", json=payload, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    # OpenAI-compatible SSE: lines come as 'data: {...}' or '[DONE]'
                    if line.startswith(":"):
                        # comment/keepalive
                        yield f"{line}\n"
                        continue
                    if line.startswith("data: "):
                        data = line[6:].strip()
                        if data == "[DONE]":
                            # Send final
                            text = "".join(full_text)
                            yield f"data: {json.dumps({"done": True, "text": text})}\n\n"
                            break
                        try:
                            obj = json.loads(data)
                            # Extract delta content, if any
                            choices = obj.get("choices", [])
                            if choices:
                                delta = choices[0].get("delta", {})
                                content = delta.get("content")
                                if content:
                                    full_text.append(content)
                                    yield f"data: {json.dumps({"token": content})}\n\n"
                        except Exception:
                            # If a non-JSON event arrives, forward as comment to avoid breaking the stream
                            yield f": {data}\n"
                    else:
                        # Non-SSE line, forward as comment
                        yield f": {line}\n"

    async def event_gen_fallback():
        # No gateway configured; produce a simple simulated stream
        try:
            result = await route_llm_call(req.taskName, [m.model_dump() for m in req.messages], req.options)
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            text = content if isinstance(content, str) else str(content)
        except Exception as e:
            # Surface the error as an SSE error comment and terminate
            err = f"route_llm_call failed: {e}"
            yield f": {err}\n\n"
            yield f"data: {json.dumps({"done": True, "text": ""})}\n\n"
            return

        # Chunk by ~60 chars to feel responsive
        chunk_size = 60
        for i in range(0, len(text), chunk_size):
            piece = text[i:i+chunk_size]
            yield f"data: {json.dumps({"token": piece})}\n\n"
            # Cooperative yield to the event loop
            # (no sleep to keep latency minimal but allow flush)
        yield f"data: {json.dumps({"done": True, "text": text})}\n\n"

    # Choose gateway streaming if configured, else fallback
    if token and base_url:
        generator = event_gen_gateway()
    else:
        generator = event_gen_fallback()

    return StreamingResponse(generator, media_type="text/event-stream")
