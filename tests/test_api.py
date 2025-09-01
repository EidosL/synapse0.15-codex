import pytest
import asyncio
from httpx import AsyncClient, ASGITransport
from asgi_lifespan import LifespanManager
from unittest.mock import AsyncMock, MagicMock
from fastapi import BackgroundTasks

# Although we are testing the API, the test still needs to run the backend code,
# so we need to set the environment variables.
import os
os.environ["GOOGLE_API_KEY"] = "test-key"
os.environ["SERPAPI_API_KEY"] = "test-key"

import sentence_transformers
from jobs import JobState, JobResult, Insight

# --- Test Data and Mocks ---

MOCK_NOTES = [
    # Using dynamic IDs is not ideal for mocks, but for this test, we create them first.
    {"title": "Source Note", "content": "This is the source note about cats."},
    {"title": "Candidate Note", "content": "This is a candidate note about dogs."}
]

# --- API Contract Test ---

@pytest.mark.asyncio
async def test_insight_generation_flow(monkeypatch):
    """
    Tests the full API flow from starting a job to getting a completed status.
    Mocks out the expensive AI and agent calls to run quickly.
    """
    # 1. Arrange: Mock the pipeline functions using monkeypatch

    sentence_transformers.SentenceTransformer = MagicMock(return_value=MagicMock(encode=lambda texts, convert_to_tensor=False: []))
    import server
    from server import app
    import src.services.embedding_service as embedding_service

    # This is the key change: we patch BackgroundTasks.add_task to run the task on the current event loop
    def mock_add_task(self, task, *args, **kwargs):
        asyncio.create_task(task(*args, **kwargs))
    monkeypatch.setattr(BackgroundTasks, "add_task", mock_add_task)

    async def mock_generate_and_store_embeddings_for_note(note, db):
        return
    monkeypatch.setattr(embedding_service, 'generate_and_store_embeddings_for_note', mock_generate_and_store_embeddings_for_note)

    mock_result = JobResult(
        version="v2",
        insights=[Insight(insight_id="1", title="The core insight. — refined via agentic research", score=0.9, agenticTranscript="Agent transcript")]
    )
    mock_pipeline = AsyncMock(return_value=mock_result)
    monkeypatch.setattr(server, 'run_full_insight_pipeline', mock_pipeline)


    async with LifespanManager(app) as manager:
        transport = ASGITransport(app=manager.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Create notes and get their dynamic IDs
            note1_res = await client.post("/api/notes/", json=MOCK_NOTES[0])
            note2_res = await client.post("/api/notes/", json=MOCK_NOTES[1])
            assert note1_res.status_code == 201
            assert note2_res.status_code == 201
            note1_id = note1_res.json()["id"]

            # 2. Act
            # Start the job with the new payload
            start_payload = {"source_note_id": note1_id}
            response = await client.post("/api/generate-insights", json=start_payload)

            # Assert the start response
            assert response.status_code == 202, response.text
            start_data = response.json()
            assert "job_id" in start_data
            job_id = start_data["job_id"]

            # Poll for completion
            final_status = None
            for _ in range(20): # Poll up to 10 seconds
                await asyncio.sleep(0.5)
                status_response = await client.get(f"/api/jobs/{job_id}")
                assert status_response.status_code == 200
                status_data = status_response.json()
                if status_data["status"] in [JobState.SUCCEEDED, JobState.FAILED]:
                    final_status = status_data
                    break

            # 3. Assert the final status
            assert final_status is not None, "Job did not complete in time"
            assert final_status["status"] == JobState.SUCCEEDED
            assert final_status["result"] is not None
            assert final_status["result"]["version"] == "v2"
            assert len(final_status["result"]["insights"]) > 0
            assert "refined via agentic research" in final_status["result"]["insights"][0]["title"]
            assert "agenticTranscript" in final_status["result"]["insights"][0]
