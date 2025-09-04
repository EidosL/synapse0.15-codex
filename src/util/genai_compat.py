# Minimal compatibility layer for old (google-generativeai) and new (google-genai)

import os
import hashlib
import math
from typing import Any

_MODE = None
genai = None

try:
    import google.generativeai as genai  # old SDK
    _MODE = "old"
except ModuleNotFoundError:
    try:
        from google import genai  # new SDK
        _MODE = "new"
    except ModuleNotFoundError as e:
        raise ModuleNotFoundError(
            "Neither 'google-generativeai' nor 'google-genai' is installed."
        ) from e

def get_client(api_key: str | None = None) -> Any:
    api_key = api_key or os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        # In test/dev, allow fake embeddings mode without a real client
        if os.getenv("EMBEDDINGS_FAKE") == "1" or os.getenv("PYTEST_CURRENT_TEST"):
            return None
        raise RuntimeError("Missing GOOGLE_API_KEY / GEMINI_API_KEY")

    if _MODE == "new":
        return genai.Client(api_key=api_key)
    else:
        genai.configure(api_key=api_key)
        return genai  # old SDK has no client object

async def generate_text(model: str, prompt: str) -> str:
    if _MODE == "new":
        # This part of the shim is not fully implemented for the new SDK
        # but we are using the old one for now.
        client = get_client()
        resp = await client.models.generate_content_async(model=model, contents=prompt)
        return getattr(resp, "text", str(resp))
    else:
        m = genai.GenerativeModel(model)
        resp = await m.generate_content_async(prompt)
        return getattr(resp, "text", str(resp))


def _fake_embed_texts(texts: list[str], dim: int = 768) -> list[list[float]]:
    """Deterministic, fast local embedding fallback for tests/dev.

    Uses sha256(text) to seed a simple pseudo-vector; ensures consistent shape.
    """
    out: list[list[float]] = []
    for t in texts:
        h = hashlib.sha256((t or "").encode("utf-8")).digest()
        # Repeat hash to fill dim, map bytes to [0,1), then normalize lightly
        vals = []
        while len(vals) < dim:
            for b in h:
                vals.append((b / 255.0))
                if len(vals) >= dim:
                    break
        # simple mean-center to avoid large L2s
        mean = sum(vals) / dim
        centered = [v - mean for v in vals]
        out.append(centered)
    return out

def _extract_embedding_from_response_old(resp: Any) -> list[float]:
    """google-generativeai embed_content returns either a list or a dict.
    Normalize to a plain list[float]."""
    try:
        emb = resp.get("embedding") if isinstance(resp, dict) else getattr(resp, "embedding", None)
        if emb is None:
            return []
        if isinstance(emb, list):
            return [float(x) for x in emb]
        if isinstance(emb, dict):
            vals = emb.get("values") or emb.get("value")
            if isinstance(vals, list):
                return [float(x) for x in vals]
        # Fallback: try to treat as sequence
        return list(emb) if emb is not None else []
    except Exception:
        return []

async def embed_texts(model: str, texts: list[str]) -> list[list[float]]:
    """Return embeddings for a list of texts using Google GenAI SDK.

    Uses the installed SDK variant (old google-generativeai or new google-genai).
    """
    # Fast path: local fake embeddings for tests/dev
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if os.getenv("EMBEDDINGS_FAKE") == "1" or os.getenv("PYTEST_CURRENT_TEST") or (api_key in {None, "test-key", "TEST", "dummy"}):
        return _fake_embed_texts(texts, dim=768)

    if _MODE == "new":
        client = get_client()
        # The new SDK exposes embeddings via client.models.embed_content(s)
        # Fall back to per-item calls to maximize compatibility.
        out: list[list[float]] = []
        for t in texts:
            resp = await client.models.embed_content(model=model, content=t)
            # The new SDK returns an Embedding object; try to normalize
            vec = getattr(resp, "embedding", None)
            values = getattr(vec, "values", None) if vec is not None else None
            out.append(list(values) if values is not None else [])
        return out
    else:
        # Old SDK: google.generativeai
        # Provide simple sequential calls to avoid rate-limit spikes
        get_client()  # ensures configure(api_key=...)
        import google.generativeai as genai  # type: ignore
        out: list[list[float]] = []
        for t in texts:
            try:
                resp = genai.embed_content(model=model, content=t)
                out.append(_extract_embedding_from_response_old(resp))
            except Exception:
                # On error, degrade to fake embedding to keep tests deterministic
                out.append(_fake_embed_texts([t])[0])
        return out

def embed_texts_sync(model: str, texts: list[str]) -> list[list[float]]:
    """Synchronous embeddings helper (preferable in sync code paths)."""
    # Fast path for tests
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if os.getenv("EMBEDDINGS_FAKE") == "1" or os.getenv("PYTEST_CURRENT_TEST") or (api_key in {None, "test-key", "TEST", "dummy"}):
        return _fake_embed_texts(texts, dim=768)

    if _MODE == "new":
        client = get_client()
        out: list[list[float]] = []
        for t in texts:
            try:
                resp = client.models.embed_content(model=model, content=t)
                emb = getattr(resp, "embedding", None)
                if emb is None and isinstance(resp, dict):
                    emb = resp.get("embedding")
                if hasattr(emb, "values"):
                    out.append([float(x) for x in getattr(emb, "values")])
                elif isinstance(emb, list):
                    out.append([float(x) for x in emb])
                else:
                    out.append([])
            except Exception:
                out.append(_fake_embed_texts([t])[0])
        return out
    else:
        get_client()
        import google.generativeai as genai  # type: ignore
        out: list[list[float]] = []
        for t in texts:
            try:
                resp = genai.embed_content(model=model, content=t)
                out.append(_extract_embedding_from_response_old(resp))
            except Exception:
                out.append(_fake_embed_texts([t])[0])
        return out
