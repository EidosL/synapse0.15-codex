from fastapi import FastAPI, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Dict, Any
import time
import asyncio
from contextlib import asynccontextmanager
import os
import sys
import uuid

# Load environment variables early so downstream modules see them
try:
    from dotenv import load_dotenv
    # Load .env first
    load_dotenv()
    # Then overlay .env.local if present (does not override already-set envs by default)
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env.local"), override=False)
except Exception:
    pass

# Optionally vendor the bundled AgentScope library for observability/tracing
def _vendor_agentscope():
    try:
        import sys, os
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        vendor_src = os.path.join(repo_root, "agentscope-1.0.1", "src")
        if os.path.isdir(vendor_src) and vendor_src not in sys.path:
            sys.path.insert(0, vendor_src)
    except Exception:
        pass

_vendor_agentscope()

# Clean imports for the new architecture
from src.jobs import router as jobs_router, job_store, JobState, JobResult
from src.progress import ProgressReporter
from src import backend_pipeline
# Back-compat alias for tests that patch server.run_full_insight_pipeline
run_full_insight_pipeline = backend_pipeline.run_full_insight_pipeline
from src.database import models, database
from src.services.vector_index_manager import vector_index_manager
from src.api import notes as notes_router
from src.api import search as search_router
from src.api import imports as imports_router
from src.api import llm as llm_router
from src.api import insights_store as insights_router
from src.api import filesync_routes as filesync_router
from src.api import yaotong as yaotong_router
from src.api import chunks as chunks_router
from src.api import metrics as metrics_router
from src.services.filesync import import_notes_from_folder, watch_and_import_loop

# --- App Lifecycle ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # On startup:
    # Initialize database tables
    async with database.engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)
    # The vector index is loaded automatically when its instance is created.
    # Optionally import notes from local folder (Markdown/TXT) on startup.
    async for db in database.get_db():
        try:
            try:
                imported = await import_notes_from_folder(db)
                if imported:
                    print(f"Imported/updated {imported} note(s) from local folder.")
            except Exception as e:
                print(f"File import skipped due to error: {e}")
        finally:
            await db.close()

    # Initialize AgentScope (if available and configured)
    try:
        import agentscope as ascope  # type: ignore
        ascope.init(
            project=os.getenv("AGENTSCOPE_PROJECT", "synapse"),
            name=os.getenv("AGENTSCOPE_RUN_NAME", None),
            logging_path=os.getenv("AGENTSCOPE_LOG_FILE", None),
            logging_level=os.getenv("AGENTSCOPE_LOG_LEVEL", "INFO"),
            studio_url=os.getenv("AGENTSCOPE_STUDIO_URL", None),
            tracing_url=os.getenv("AGENTSCOPE_TRACING_URL", None),
        )
        app.state._agentscope_enabled = True
    except Exception as e:
        # If not installed or not configured, continue silently
        app.state._agentscope_enabled = False

    # Start background watcher to auto-import notes periodically
    import asyncio
    app.state._filesync_task = asyncio.create_task(watch_and_import_loop(database.get_db))

    yield

    # On shutdown:
    # Save the vector index
    await vector_index_manager.save()
    # Stop watcher
    task = getattr(app.state, "_filesync_task", None)
    if task:
        task.cancel()

# --- Main App Setup ---
app = FastAPI(lifespan=lifespan)

# CORS for local dev (Vite at 5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(jobs_router)
app.include_router(notes_router.router)
app.include_router(search_router.router)
app.include_router(imports_router.router)
app.include_router(llm_router.router)
app.include_router(insights_router.router)
app.include_router(filesync_router.router)
app.include_router(yaotong_router.router)
app.include_router(chunks_router.router)
app.include_router(metrics_router.router)

from src.api.schemas import GenerateInsightsRequest, StartResponse

# --- Endpoints ---

from src.database import crud, schemas

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
                    all_notes = [
                        schemas.Note.model_validate(n).model_dump(mode="json")
                        for n in all_notes_db
                    ]

                    if not all_notes:
                        raise ValueError("No notes found in the database.")

                    # Construct the pipeline input
                    pipeline_input = backend_pipeline.PipelineInput(
                        source_note_id=str(source_note_id),
                        notes=all_notes
                    )
                    # Prefer a possibly monkeypatched alias on this module for tests
                    func = getattr(sys.modules[__name__], "run_full_insight_pipeline", None) or backend_pipeline.run_full_insight_pipeline
                    result: JobResult = await func(pipeline_input, reporter, db)

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

# --- Health Check ---
@app.get("/api/health")
async def health():
    llm_configured = bool(os.getenv("VERCEL_AI_GATEWAY_TOKEN") and os.getenv("VERCEL_AI_GATEWAY_URL")) or \
                     bool(os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))
    serpapi_configured = bool(os.getenv("SERPAPI_API_KEY"))
    agentscope_configured = bool(os.getenv("AGENTSCOPE_STUDIO_URL") or os.getenv("AGENTSCOPE_TRACING_URL"))
    return {
        "status": "ok",
        "llmConfigured": llm_configured,
        "serpapiConfigured": serpapi_configured,
        "agentscopeConfigured": agentscope_configured,
    }

# --- Static Frontend (Production) ---
# If a Vite build exists (./dist), serve it from the FastAPI app.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(BASE_DIR, "dist")

if os.path.isdir(DIST_DIR):
    index_path = os.path.join(DIST_DIR, "index.html")
    assets_path = os.path.join(DIST_DIR, "assets")
    public_path = os.path.join(DIST_DIR, "public")

    @app.get("/")
    async def serve_index():
        if os.path.isfile(index_path):
            return FileResponse(index_path)
        return {"status": "ok"}

    if os.path.isdir(assets_path):
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")
    if os.path.isdir(public_path):
        app.mount("/public", StaticFiles(directory=public_path), name="public")
