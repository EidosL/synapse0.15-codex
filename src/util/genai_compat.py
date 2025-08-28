# Minimal compatibility layer for old (google-generativeai) and new (google-genai)

import os
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
