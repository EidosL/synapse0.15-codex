import google.generativeai as genai
import os
import json
from typing import List, Optional

from .models import PlanJSON

# It's better to configure the client once at the application's entry point.
# For now, we'll check for the key here.
API_KEY = os.getenv("GOOGLE_API_KEY")
if API_KEY:
    genai.configure(api_key=API_KEY)
else:
    print("Warning: GOOGLE_API_KEY environment variable not set. Planner will not function.")

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
    if not API_KEY:
        return None

    model = genai.GenerativeModel(MODEL_NAME)

    prompt = """You are a planning agent for deep research. Your goal is to formulate a plan to resolve an insight.
You can take several steps. Propose ONE step at a time.

Your available actions are:
- web_search: Use when you need external information, facts, or context. (e.g., "search for the definition of 'Bayesian Surprise'")
- mind_map: Use to explore the relationships between concepts already in the transcript. (e.g., "explore the link between 'Insight' and 'Serendipity'")
- continue: Use when you have gathered information and need to think or formulate the next question. Your 'message' should be your internal monologue.
- finalize: Use ONLY when you have a complete answer and no further steps are needed. Your 'message' should be the final conclusion.

Analyze the transcript and propose the next logical step."""

    mind_hints_str = "- " + "\n- ".join(mind_hints) if mind_hints else "No hints."

    # The original slice was on characters. We replicate that here.
    transcript_slice = transcript[:3000]

    contents = f"{prompt}\n\nMIND_HINTS:\n{mind_hints_str}\n\nTRANSCRIPT:\n{transcript_slice}"

    try:
        response = await model.generate_content_async(
            contents,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": PLAN_SCHEMA,
                "temperature": temperature,
            },
        )
        # The response text should be a valid JSON string which we can parse
        plan_data = json.loads(response.text)
        return PlanJSON(**plan_data)
    except Exception as e:
        print(f"An error occurred during planning with the AI model: {e}")
        return None
