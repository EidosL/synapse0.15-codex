import asyncio
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from typing import List

from src.jobs import job_store
from src.api.schemas import StartResponse

router = APIRouter(
    prefix="/api/imports",
    tags=["imports"],
)

async def bulk_import_runner(job_id: str, files: List[UploadFile]):
    """
    The background task runner for the bulk import process.
    """
    # This is where the main logic from the user's suggestion will go:
    # 1. Ingestion: stream files, extract text, create note rows.
    # 2. Chunking
    # 3. Embedding
    # 4. Indexing
    print(f"Starting bulk import job {job_id} with {len(files)} files.")
    # For now, just a placeholder
    await asyncio.sleep(5) # Simulate work
    result = {"status": "complete", "notes_created": len(files)}
    await job_store.complete(job_id, result)


@router.post("/start", response_model=StartResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_import_job(files: List[UploadFile] = File(...)):
    """
    Starts a background job to handle the bulk import of notes from files.
    """
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No files were uploaded.")

    job = await job_store.create()

    # FastAPI's BackgroundTasks isn't suitable for this because UploadFile
    # objects are not available after the request-response cycle.
    # A more robust solution like Celery would be ideal, but for now,
    # we can run it as a standalone asyncio task.
    # Note: This has limitations in a production multi-worker environment.
    asyncio.create_task(bulk_import_runner(job.view.job_id, files))

    return StartResponse(job_id=job.view.job_id, trace_id=job.view.trace_id)
