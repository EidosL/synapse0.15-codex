import pytest
import asyncio
from unittest.mock import AsyncMock, patch
import json

# Set environment variable for API key before importing the planner
import os
os.environ["GOOGLE_API_KEY"] = "test-key"

from src.agentic_py.planner import plan_next_step
from src.agentic_py.models import PlanJSON

@pytest.mark.asyncio
async def test_plan_next_step_success():
    """
    Tests that plan_next_step successfully parses a valid JSON response from the AI model.
    """
    # 1. Arrange: Create a mock response
    mock_plan_data = {
        "rationale": "The transcript is empty, so I need to start by searching the web.",
        "step": {
            "action": "web_search",
            "message": "initial query about the topic",
            "expected": "a general overview of the topic"
        }
    }
    mock_response = AsyncMock()
    # The 'text' attribute of the response object needs to be a JSON string
    mock_response.text = json.dumps(mock_plan_data)

    # 2. Act: Patch the model's method and call the planner
    # The patch target is where the object is looked up, which is inside the planner module
    with patch('src.agentic_py.planner.genai.GenerativeModel.generate_content_async', new_callable=AsyncMock) as mock_generate:
        mock_generate.return_value = mock_response

        result = await plan_next_step(
            transcript="INSIGHT: some new idea",
            mind_hints=[],
            temperature=0.5
        )

    # 3. Assert: Check if the result is as expected
    assert result is not None
    assert isinstance(result, PlanJSON)
    assert result.rationale == "The transcript is empty, so I need to start by searching the web."
    assert result.step.action == "web_search"
    assert result.step.message == "initial query about the topic"

@pytest.mark.asyncio
async def test_plan_next_step_error():
    """
    Tests that plan_next_step returns None if the AI call fails.
    """
    # 1. Arrange: Configure the mock to raise an exception
    with patch('src.agentic_py.planner.genai.GenerativeModel.generate_content_async', new_callable=AsyncMock) as mock_generate:
        mock_generate.side_effect = Exception("AI API is down")

        # 2. Act
        result = await plan_next_step(
            transcript="some transcript",
            mind_hints=[]
        )

    # 3. Assert
    assert result is None
