import pytest
import os
import json
from unittest.mock import patch, AsyncMock

# Set environment variable for API key before importing
os.environ["GOOGLE_API_KEY"] = "test-key"

from src.agentic_py.tools import MindMapTool
from src.agentic_py.models import MindMap, MindNode, MindEdge

# --- Test Data ---
MOCK_MIND_MAP_1 = MindMap(
    nodes=[MindNode(id="n1", label="Topic A", kind="concept")],
    edges=[MindEdge(s="n1", t="n2", rel="related")],
    summaries=["Summary 1"]
)

MOCK_MIND_MAP_2 = MindMap(
    nodes=[MindNode(id="n3", label="Topic C", kind="entity")],
    edges=[MindEdge(s="n1", t="n3", rel="related")],
    summaries=["Summary 2"]
)

# --- Test Cases ---

@pytest.fixture
def temp_storage_file(tmp_path):
    """Pytest fixture to create a temporary storage file for tests."""
    return os.path.join(tmp_path, "test_mindmaps.json")

@pytest.mark.asyncio
@patch('src.agentic_py.tools.build_mind_map_from_transcript', new_callable=AsyncMock)
async def test_mind_map_tool_persistence(mock_build_map, temp_storage_file):
    """
    Tests that the MindMapTool correctly persists its state to a JSON file.
    """
    # 1. Arrange
    mock_build_map.return_value = MOCK_MIND_MAP_1
    tool1 = MindMapTool(storage_path=temp_storage_file, session_id="test_session")

    # 2. Act
    await tool1.update("some transcript")

    # 3. Assert
    # Check if the file was created and contains the data
    assert os.path.exists(temp_storage_file)
    with open(temp_storage_file, 'r') as f:
        data = json.load(f)
    assert "test_session" in data
    assert data["test_session"]["nodes"][0]["label"] == "Topic A"

    # Create a new instance and check if it loads the persisted data
    tool2 = MindMapTool(storage_path=temp_storage_file, session_id="test_session")
    assert "test_session" in tool2.graphs
    assert tool2.graphs["test_session"]["nodes"][0]["label"] == "Topic A"

@pytest.mark.asyncio
@patch('src.agentic_py.tools.build_mind_map_from_transcript', new_callable=AsyncMock)
async def test_mind_map_tool_merge(mock_build_map, temp_storage_file):
    """
    Tests that the update method correctly merges new data into the existing graph.
    """
    # 1. Arrange
    tool = MindMapTool(storage_path=temp_storage_file, session_id="test_session")

    # First update
    mock_build_map.return_value = MOCK_MIND_MAP_1
    await tool.update("first transcript")

    # Second update
    mock_build_map.return_value = MOCK_MIND_MAP_2
    await tool.update("second transcript")

    # 2. Assert
    graph = tool.graphs["test_session"]
    assert len(graph["nodes"]) == 2  # n1 and n3 (deduplicated)
    assert len(graph["edges"]) == 2  # n1->n2 and n1->n3
    assert graph["summaries"] == ["Summary 2"] # Summary is overwritten

@pytest.mark.asyncio
async def test_mind_map_tool_answer(temp_storage_file):
    """
    Tests the answer method's ability to find paths in the graph.
    """
    # 1. Arrange
    tool = MindMapTool(storage_path=temp_storage_file, session_id="test_session")
    # Manually set the graph state for this test
    tool.graphs["test_session"] = {
        "nodes": [
            {"id": "n1", "label": "Python"},
            {"id": "n2", "label": "Web Dev"},
            {"id": "n3", "label": "FastAPI"}
        ],
        "edges": [
            {"s": "n1", "t": "n2", "rel": "used for"},
            {"s": "n3", "t": "n2", "rel": "is a framework for"}
        ],
        "summaries": ["A summary."]
    }

    # 2. Act
    answer = await tool.answer("fastapi")

    # 3. Assert
    assert "FastAPI -[is a framework for]-> Web Dev" in answer
