import pytest
import os
from unittest.mock import patch, AsyncMock

# Set environment variable for API key before importing
os.environ["GOOGLE_API_KEY"] = "test-key"

from src.agentic_py.tools.web_search import WebSearchTool
from src.agentic_py.models import PlanStep

@pytest.mark.asyncio
@patch('src.agentic_py.tools.web_search.core_web_search', new_callable=AsyncMock)
@patch('src.agentic_py.tools.web_search.generate_text', new_callable=AsyncMock)
async def test_web_search_tool_execute(mock_generate_text, mock_core_search):
    """
    Tests the execute method of the WebSearchTool.
    """
    # 1. Arrange
    # Mock the response from the core web search
    mock_core_search.return_value = [
        {"title": "Result 1", "snippet": "This is the first result.", "url": "http://example.com/1"},
        {"title": "Result 2", "snippet": "This is the second result.", "url": "http://example.com/2"},
    ]

    # Mock the response from the generative AI model for summarization
    mock_generate_text.return_value = "This is a summary."

    tool = WebSearchTool()
    step = PlanStep(action='web_search', message='test query', expected='test expectation')

    # 2. Act
    result = await tool.execute(step)

    # 3. Assert
    assert result.ok is True
    assert result.action == 'web_search'
    assert "WEB_SUMMARY" in result.content
    assert "This is a summary." in result.content
    assert len(result.citations) == 2
    assert result.citations[0].url == "http://example.com/1"

    # Verify that the mocks were called
    mock_core_search.assert_called_once_with('test query', 5)
    mock_generate_text.assert_called_once()
