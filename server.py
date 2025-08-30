from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from typing import List, Dict, Any
import time
import asyncio
from contextlib import asynccontextmanager

# Clean imports for the new architecture
from jobs import router as jobs_router, job_store, JobState, JobResult
from progress import ProgressReporter
from backend_pipeline import run_full_insight_pipeline, PipelineInput
from database import models, database
from services.vector_index_manager import vector_index_manager
from api import notes as notes_router
from api import search as search_router
from api import imports as imports_router
import uuid

# --- App Lifecycle ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # On startup:
    # Initialize database tables
    async with database.engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)
    # The vector index is loaded automatically when its instance is created.

    yield

    # On shutdown:
    # Save the vector index
    await vector_index_manager.save()

# --- Main App Setup ---
app = FastAPI(lifespan=lifespan)
app.include_router(jobs_router)
app.include_router(notes_router.router)
app.include_router(search_router.router)
app.include_router(imports_router.router)

from api.schemas import GenerateInsightsRequest, StartResponse

# --- Endpoints ---

from database import crud, schemas

@app.post("/api/generate-insights", response_model=StartResponse, status_code=202)
async def generate_insights(req: GenerateInsightsRequest, tasks: BackgroundTasks):
    """
    Starts the insight generation pipeline in the background.
    The note data is now fetched from the database instead of being passed in the request.
    """
    job = await job_store.create()

    async def _runner(job_id: str, source_note_id: uuid.UUID):
        t0 = time.perf_counter()
        try:
            reporter = ProgressReporter(job_store, job_id, t0)
            await job_store.update(job_id, status=JobState.RUNNING)

            # The pipeline now needs a db session
            async for db in database.get_db():
                try:
                    all_notes_db = await crud.get_notes(db, limit=1000) # A reasonable limit for now
                    # Convert SQLAlchemy models to dicts for the pipeline
                    all_notes = [schemas.Note.from_orm(n).model_dump(mode='json') for n in all_notes_db]

                    if not all_notes:
                        raise ValueError("No notes found in the database.")

                    # Construct the pipeline input
                    pipeline_input = PipelineInput(
                        source_note_id=str(source_note_id),
                        notes=all_notes
                    )
                    result: JobResult = await run_full_insight_pipeline(pipeline_input, reporter, db)

                    await job_store.complete(job_id, result)
                finally:
                    # Ensure the session is closed
                    await db.close()
        except asyncio.CancelledError:
            print(f"Job {job_id} was cancelled.")
        except Exception as e:
            print(f"Runner for job {job_id} caught exception: {e}")
            await job_store.fail(job_id, code=type(e).__name__, message=str(e))

    tasks.add_task(_runner, job.view.job_id, req.source_note_id)
    return StartResponse(job_id=job.view.job_id, trace_id=job.view.trace_id)

# Routers are included in the main app setup section above.
