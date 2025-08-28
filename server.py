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
