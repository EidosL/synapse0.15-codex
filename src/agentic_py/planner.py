import google.generativeai as genai
import os
import json
from typing import List, Optional

from .models import PlanJSON
from src.synapse.config.llm import llm_structured

def _ensure_configured() -> bool:
    """Ensure the Google GenAI client is configured with an API key.

    Returns True when configured, False otherwise. We check env at call time
    so .env loaded later (e.g., by server startup) is respected.
    """
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        return False
    try:
        genai.configure(api_key=api_key)
        return True
    except Exception:
        return False

# The TS code used 'gemini-2.5-flash', but let's use a more standard and available model
# for this porting exercise, as specific model versions can change.
# 'gemini-1.5-flash' is a safe and powerful default.
MODEL_NAME = 'gemini-1.5-flash'

# This schema needs to match the structure expected by the Google GenAI API
PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "rationale": {"type": "string"},
        "step": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["web_search", "mind_map", "continue", "finalize", "none"]},
                "message": {"type": "string"},
                "expected": {"type": "string"},
            },
            "required": ["action", "message", "expected"],
        },
    },
    "required": ["rationale", "step"],
}

async def plan_next_step(
    transcript: str,
    mind_hints: List[str],
    temperature: float = 0.4
) -> Optional[PlanJSON]:
    """
    Analyzes the transcript and decides on the next step for the agent.
    """
    # Prefer centralized router for production usage
    try:
        # Build concise messages for structured output
        sys_msg = {
            "role": "system",
            "content": (
                "You are a planning agent for deep research. Return a JSON object with "
                "fields: rationale (string) and step {action, message, expected}. "
                "Action must be one of: web_search | mind_map | continue | finalize | none."
            ),
        }
        mind_hints_str = "- " + "\n- ".join(mind_hints) if mind_hints else "No hints."
        user_msg = {
            "role": "user",
            "content": (
                f"MIND_HINTS:\n{mind_hints_str}\n\nTRANSCRIPT:\n{transcript[:3000]}"
            ),
        }
        result = await llm_structured("planNextStep", [sys_msg, user_msg], structured_model=PlanJSON, options={"temperature": temperature})
        if result:
            return result
    except Exception:
        # Fall back to legacy Google SDK path
        pass

    # Legacy fallback (kept for tests that patch genai path)
    if not _ensure_configured():
        return None
    try:
        model = genai.GenerativeModel(MODEL_NAME)
        prompt = """You are a planning agent for deep research. Your goal is to formulate a plan to resolve an insight.
You can take several steps. Propose ONE step at a time.

Your available actions are:
- web_search: Use when you need external information, facts, or context.
- mind_map: Use to explore relationships between concepts already in the transcript.
- continue: Use when you need to think or formulate the next question.
- finalize: Use ONLY when you have a complete answer.

Analyze the transcript and propose the next logical step."""
        mind_hints_str = "- " + "\n- ".join(mind_hints) if mind_hints else "No hints."
        transcript_slice = transcript[:3000]
        contents = f"{prompt}\n\nMIND_HINTS:\n{mind_hints_str}\n\nTRANSCRIPT:\n{transcript_slice}"
        response = await model.generate_content_async(
            contents,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": PLAN_SCHEMA,
                "temperature": temperature,
            },
        )
        plan_data = json.loads(response.text)
        return PlanJSON(**plan_data)
    except Exception as e:
        print(f"An error occurred during planning with the AI model: {e}")
        return None
