import asyncio
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from typing import List, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from src.jobs import job_store, JobResult, Insight, Phase
from src.database.database import get_db
from src.database import crud, schemas
from src.services import embedding_service
from src.api.schemas import StartResponse

router = APIRouter(
    prefix="/api/imports",
    tags=["imports"],
)

async def bulk_import_runner(job_id: str, files_data: List[Tuple[str, bytes]]):
    """
    The background task runner for the bulk import process.
    """
    # This is where the main logic from the user's suggestion will go:
    # 1. Ingestion: stream files, extract text, create note rows.
    # 2. Chunking
    # 3. Embedding
    # 4. Indexing
    print(f"Starting bulk import job {job_id} with {len(files_data)} files.")
    # Process each file: create note -> chunk/embed -> index
    created_note_ids: List[str] = []
    try:
        # Use a short-lived DB session from the generator
        from src.database import database
        async for db in database.get_db():
            try:
                for idx, (filename, data) in enumerate(files_data):
                    # Basic decoding; fallback if needed
                    try:
                        text = data.decode('utf-8')
                    except Exception:
                        try:
                            text = data.decode('latin-1')
                        except Exception:
                            text = ''

                    title = filename.rsplit('/', 1)[-1].rsplit('\\\
', 1)[-1]
                    # Create note row
                    db_note = await crud.create_note(db, schemas.NoteCreate(title=title or 'Untitled', content=text))
                    created_note_ids.append(str(db_note.id))

                    # Generate chunks/embeddings and update index
                    await embedding_service.generate_and_store_embeddings_for_note(db_note, db)

                    # Emit basic heartbeat
                    pct = int(((idx + 1) / max(1, len(files_data))) * 100)
                    await job_store.heartbeat(job_id, phase=Phase.candidate_selection, pct=pct)

                await db.commit()
            finally:
                await db.close()

        # Complete with a simple insight summarizing the import
        summary = Insight(insight_id="import-summary", title=f"Imported {len(created_note_ids)} file(s)", score=1.0)
        await job_store.complete(job_id, JobResult(insights=[summary]))
    except Exception as e:
        await job_store.fail(job_id, code=type(e).__name__, message=str(e))


@router.post("/start", response_model=StartResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_import_job(files: List[UploadFile] = File(...)):
    """
    Starts a background job to handle the bulk import of notes from files.
    """
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No files were uploaded.")

    job = await job_store.create()

    # Read files into memory so they survive beyond the request lifecycle
    files_data: List[Tuple[str, bytes]] = []
    for f in files:
        content = await f.read()
        files_data.append((f.filename or 'untitled', content))

    # FastAPI's BackgroundTasks isn't suitable for this because UploadFile
    # objects are not available after the request-response cycle.
    # A more robust solution like Celery would be ideal, but for now,
    # we can run it as a standalone asyncio task.
    # Note: This has limitations in a production multi-worker environment.
    asyncio.create_task(bulk_import_runner(job.view.job_id, files_data))

    return StartResponse(job_id=job.view.job_id, trace_id=job.view.trace_id)
