import pytest
import os
import json
import math
from unittest.mock import AsyncMock, patch

# Import the functions to be tested
from src.backend.ranking import counter_insight_check, rank_insights

# --- Tests for counter_insight_check ---

@pytest.mark.asyncio
@patch('src.backend.ranking.genai.GenerativeModel.generate_content_async')
async def test_counter_insight_check_success(mock_generate_content):
    """Tests counter_insight_check for a successful API call."""
    os.environ["GOOGLE_API_KEY"] = "test-key"

    # Arrange: Mock the API response
    mock_response_data = {"weakness": "Test weakness", "severity": 0.8, "counterEvidence": []}
    mock_response = AsyncMock()
    # The real API returns a model response object, which has a 'text' attribute
    type(mock_response).text = json.dumps(mock_response_data)
    mock_generate_content.return_value = mock_response

    # Act
    result = await counter_insight_check("some insight", [{"text": "some evidence"}])

    # Assert
    assert result == mock_response_data
    mock_generate_content.assert_called_once()

    # Cleanup
    del os.environ["GOOGLE_API_KEY"]

@pytest.mark.asyncio
@patch('src.backend.ranking.genai.GenerativeModel.generate_content_async')
async def test_counter_insight_check_api_error(mock_generate_content):
    """Tests counter_insight_check when the API call raises an exception."""
    os.environ["GOOGLE_API_KEY"] = "test-key"

    # Arrange: Mock the API to raise an error
    mock_generate_content.side_effect = Exception("API Failure")

    # Act
    result = await counter_insight_check("some insight", [{"text": "some evidence"}])

    # Assert
    assert result is None

    # Cleanup
    del os.environ["GOOGLE_API_KEY"]

@pytest.mark.asyncio
async def test_counter_insight_check_no_api_key():
    """Tests that counter_insight_check returns None if the API key is not set."""
    # Arrange: Ensure the key is not set
    if "GOOGLE_API_KEY" in os.environ:
        del os.environ["GOOGLE_API_KEY"]

    # Act
    result = await counter_insight_check("some insight", [{"text": "some evidence"}])

    # Assert
    assert result is None

# --- Tests for rank_insights ---

@pytest.fixture
def sample_insights():
    """Provides sample insight data for testing."""
    return [
        {
            # This insight should rank higher
            "insightCore": "Insight 1",
            "eurekaMarkers": {"conviction": 0.8, "fluency": 0.9},
            "bayesianSurprise": 0.7,
            "evidenceRefs": [{"noteId": "note1"}, {"noteId": "note2"}] # diversity = 2
        },
        {
            # This insight should rank lower
            "insightCore": "Insight 2",
            "eurekaMarkers": {"conviction": 0.5, "fluency": 0.6},
            "bayesianSurprise": 0.4,
            "evidenceRefs": [{"noteId": "note3"}] # diversity = 1
        }
    ]

@pytest.mark.asyncio
@patch('src.backend.ranking.counter_insight_check', new_callable=AsyncMock)
async def test_rank_insights_scoring_and_sorting(mock_counter_check, sample_insights):
    """Tests the scoring logic and sorting of rank_insights."""
    # Arrange: Mock counter_insight_check to return different penalties.
    # Insight 1 (index 0) gets no penalty.
    # Insight 2 (index 1) gets a penalty.
    mock_counter_check.side_effect = [
        None,
        {"severity": 0.5}
    ]

    # Act
    ranked_results = await rank_insights(sample_insights, {"0": [], "1": []})

    # Assert
    assert len(ranked_results) == 2

    # Calculate expected scores to verify the formula
    # Score 1: (0.4*0.8) + (0.25*0.9) + (0.15*0.7) + (0.10*tanh(2/6)) - 0
    expected_score1 = (0.4 * 0.8) + (0.25 * 0.9) + (0.15 * 0.7) + (0.10 * math.tanh(2/6.0)) - 0
    # Score 2: (0.4*0.5) + (0.25*0.6) + (0.15*0.4) + (0.10*tanh(1/6)) - (0.25 * 0.5)
    expected_score2 = (0.4 * 0.5) + (0.25 * 0.6) + (0.15 * 0.4) + (0.10 * math.tanh(1/6.0)) - (0.25 * 0.5)

    # Check that the results are sorted by score (highest first)
    assert ranked_results[0]['insightCore'] == "Insight 1"
    assert ranked_results[1]['insightCore'] == "Insight 2"

    # Check scores (with tolerance for float precision)
    assert ranked_results[0]['score'] == pytest.approx(expected_score1)
    assert ranked_results[1]['score'] == pytest.approx(expected_score2)

@pytest.mark.asyncio
async def test_rank_insights_empty_list():
    """Tests that rank_insights handles an empty list of insights correctly."""
    result = await rank_insights([], {})
    assert result == []
