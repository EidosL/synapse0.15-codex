import pytest
import asyncio
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, AsyncMock

# Although we are testing the API, the test still needs to run the backend code,
# so we need to set the environment variables.
import os
os.environ["GOOGLE_API_KEY"] = "test-key"
os.environ["SERPAPI_API_KEY"] = "test-key"

from server import app
from src.jobs import JobState
from src.eureka_rag.models import ClusteringResult, ClusterSummary

# --- Test Data and Mocks ---

MOCK_INSIGHT_RESULT = {
    "mode": "eureka",
    "reframedProblem": "A new way of seeing the problem.",
    "insightCore": "The core insight.",
    "selectedHypothesisName": "hyp1",
    "hypotheses": [{"name": "hyp1", "statement": "...", "predictedEvidence": [], "disconfirmers": [], "prior": 0.1, "posterior": 0.8}],
    "eurekaMarkers": {"suddennessProxy": 0.9, "fluency": 0.8, "conviction": 0.9, "positiveAffect": 0.9},
    "bayesianSurprise": 0.7,
    "evidenceRefs": [],
    "test": "A test.",
    "risks": []
}

MOCK_NOTES = [
    {"id": "note1", "title": "Source Note", "content": "This is the source note about cats."},
    {"id": "note2", "title": "Candidate Note", "content": "This is a candidate note about dogs."}
]

# --- API Contract Test ---

@pytest.mark.asyncio
async def test_insight_generation_flow():
    """
    Tests the full API flow from starting a job to getting a completed status.
    Mocks out the expensive AI and agent calls to run quickly.
    """
    # Patch the slow/expensive parts of the pipeline
    with patch('src.backend_pipeline.run_chunk_pipeline') as mock_cluster, \
         patch('src.backend_pipeline.generate_insight', new_callable=AsyncMock) as mock_gen_insight, \
         patch('src.backend_pipeline.maybe_auto_deepen', new_callable=AsyncMock) as mock_agent:

        # 1. Arrange
        # Mock the return values of the patched functions
        mock_cluster.return_value = ClusteringResult(
            chunk_to_cluster_map={"note1:0": 0, "note2:0": 0},
            cluster_summaries=[ClusterSummary(cluster_id=0, summary="summary")]
        )
        mock_gen_insight.return_value = MOCK_INSIGHT_RESULT
        mock_agent.return_value = "Agent transcript"

        # 2. Act
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # a. Start the job
            start_payload = {"source_note_id": "note1", "notes": MOCK_NOTES}
            response = await client.post("/api/generate-insights", json=start_payload)

            # b. Assert the start response
            assert response.status_code == 202
            start_data = response.json()
            assert "job_id" in start_data
            job_id = start_data["job_id"]

            # c. Poll for completion
            final_status = None
            for _ in range(20): # Poll up to 10 seconds
                await asyncio.sleep(0.5)
                status_response = await client.get(f"/api/insights-status/{job_id}")
                assert status_response.status_code == 200
                status_data = status_response.json()
                if status_data["status"] in [JobState.SUCCEEDED, JobState.FAILED]:
                    final_status = status_data
                    break

            # d. Assert the final status
            assert final_status is not None, "Job did not complete in time"
            assert final_status["status"] == JobState.SUCCEEDED
            assert final_status["result"] is not None
            assert final_status["result"]["version"] == "v2"
            assert len(final_status["result"]["insights"]) > 0
            assert final_status["result"]["insights"][0]["title"] == "The core insight."
            assert "agenticTranscript" in final_status["result"]["insights"][0]
