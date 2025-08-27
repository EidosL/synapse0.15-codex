from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from typing import List, Dict, Any
import time
import asyncio

# Clean imports for the new architecture
from src.jobs import router as jobs_router, job_store, JobState, JobResult
from src.progress import ProgressReporter
from src.backend_pipeline import run_full_insight_pipeline, PipelineInput

# --- Main App Setup ---
app = FastAPI()

# --- API Models for generate-insights ---
class GenerateInsightsRequest(BaseModel):
    source_note_id: str
    notes: List[Dict[str, Any]]

class StartResponse(BaseModel):
    job_id: str
    trace_id: str

# --- Endpoints ---

@app.post("/api/generate-insights", response_model=StartResponse, status_code=202)
async def generate_insights(req: GenerateInsightsRequest, tasks: BackgroundTasks):
    """
    Starts the insight generation pipeline in the background.
    """
    job = await job_store.create()

    async def _runner(job_id: str, payload: Dict[str, Any]):
        t0 = time.perf_counter()
        try:
            reporter = ProgressReporter(job_store, job_id, t0)
            await job_store.update(job_id, status=JobState.RUNNING)

            pipeline_input = PipelineInput(**payload)
            result: JobResult = await run_full_insight_pipeline(pipeline_input, reporter)

            await job_store.complete(job_id, result)
        except asyncio.CancelledError:
            # The cancel endpoint already marks the job as CANCELLED
            print(f"Job {job_id} was cancelled.")
        except Exception as e:
            print(f"Runner for job {job_id} caught exception: {e}")
            await job_store.fail(job_id, code=type(e).__name__, message=str(e))

    tasks.add_task(_runner, job.view.job_id, req.model_dump())
    return StartResponse(job_id=job.view.job_id, trace_id=job.view.trace_id)

# Include the status and cancel routes from jobs.py
app.include_router(jobs_router)


# --- Web Search Utility ---
# This function is used by the Python agent's WebSearchTool.
# It is not exposed as a public endpoint in the new architecture,
# but the core logic is preserved here for the agent to use.
import httpx
import os

async def core_web_search(q: str, k: int) -> List[Dict[str, str]]:
    api_key = os.environ.get("SERPAPI_API_KEY")
    if not api_key:
        print("Warning: SERPAPI_API_KEY not set. Web search will return no results.")
        return []
    params = { "engine": "google", "q": q, "num": str(k), "api_key": api_key, "google_domain": "google.com", "gl": "us", "hl": "en" }
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("https://serpapi.com/search", params=params)
            response.raise_for_status()
            data = response.json()
            results = data.get("organic_results", [])
            return [ {"title": r.get("title", "Untitled"), "snippet": r.get("snippet", ""), "url": r.get("link", "")} for r in results if r.get("link") ][:k]
    except Exception as e:
        print(f"An error occurred during web search: {e}")
        return []
