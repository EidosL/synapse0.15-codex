from __future__ import annotations

import os
from typing import Optional

try:
    from agentscope.model import GeminiChatModel, OpenAIChatModel, ChatModelBase  # type: ignore
except Exception:
    GeminiChatModel = OpenAIChatModel = None  # type: ignore
    ChatModelBase = object  # type: ignore


def get_chat_model(prefer: str = "gemini", stream: bool = False) -> Optional["ChatModelBase"]:
    """Return an AgentScope ChatModel based on environment, or None.

    prefer: "gemini" | "openai"
    """
    # Prefer Google Gemini if available
    if prefer == "gemini" and GeminiChatModel is not None:
        api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        model_name = os.getenv("YAOTONG_GEMINI_MODEL", "gemini-2.5-pro")
        if api_key:
            try:
                return GeminiChatModel(model_name=model_name, api_key=api_key, stream=stream)
            except Exception:
                pass

    # Fallback to OpenAI-compatible
    if OpenAIChatModel is not None:
        api_key = os.getenv("OPENAI_API_KEY") or os.getenv("VERCEL_AI_GATEWAY_TOKEN")
        base_url = os.getenv("OPENAI_BASE_URL") or os.getenv("VERCEL_AI_GATEWAY_URL")
        model_name = os.getenv("YAOTONG_OPENAI_MODEL", "gpt-4o-mini")
        if api_key and base_url:
            try:
                return OpenAIChatModel(model_name=model_name, api_key=api_key, base_url=base_url, stream=stream)
            except Exception:
                pass

    return None

