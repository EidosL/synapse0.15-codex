from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta, timezone
import asyncio, uuid, time

# ---- States & phases ---------------------------------------------------------
class JobState(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

class Phase(str, Enum):
    candidate_selection = "candidate_selection"
    initial_synthesis = "initial_synthesis"
    multi_hop = "multi_hop"
    agent_refinement = "agent_refinement"
    finalizing = "finalizing"

# ---- API models --------------------------------------------------------------
class Insight(BaseModel):
    insight_id: str
    title: str
    score: float = Field(ge=0.0, le=1.0)
    snippet: Optional[str] = None
    agenticTranscript: Optional[str] = None
    # Optional verification blob from backend_pipeline finalization
    verification: Optional[Dict[str, Any]] = None

class JobProgress(BaseModel):
    phase: Phase
    pct: int = Field(ge=0, le=100)

class JobMetrics(BaseModel):
    notes_considered: int = 0
    clusters: int = 0
    llm_calls: int = 0
    elapsed_ms: int = 0

class JobResult(BaseModel):
    version: str = "v2"
    insights: List[Insight]

class JobView(BaseModel):
    job_id: str
    status: JobState
    progress: Optional[JobProgress] = None
    started_at: datetime
    updated_at: datetime
    metrics: JobMetrics = JobMetrics()
    partial_results: List[Insight] = []
    result: Optional[JobResult] = None
    error: Optional[Dict[str, Any]] = None
    trace_id: str
    # Optional live log line for display
    log: Optional[str] = None

# ---- In-memory job store with TTL, cancel, and concurrency -------------------
class _JobInternal:
    def __init__(self, job_id: str, trace_id: str, ttl_seconds: int = 24 * 3600):
        now = datetime.now(timezone.utc)
        self.view = JobView(
            job_id=job_id,
            status=JobState.QUEUED,
            progress=JobProgress(phase=Phase.candidate_selection, pct=0),
            started_at=now,
            updated_at=now,
            trace_id=trace_id,
        )
        self.cancel_event = asyncio.Event()
        self.created_at = now
        self.ttl = timedelta(seconds=ttl_seconds)

    def is_expired(self) -> bool:
        return datetime.now(timezone.utc) - self.created_at > self.ttl

class JobStore:
    def __init__(self):
        self._jobs: Dict[str, _JobInternal] = {}
        self._lock = asyncio.Lock()

    async def create(self) -> _JobInternal:
        async with self._lock:
            job_id = str(uuid.uuid4())
            trace_id = str(uuid.uuid4())
            job = _JobInternal(job_id, trace_id)
            self._jobs[job_id] = job
            return job

    async def get(self, job_id: str) -> Optional[_JobInternal]:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job and job.is_expired():
                del self._jobs[job_id]
                return None
            return job

    async def update(self, job_id: str, **fields):
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job: raise KeyError(job_id)
            for k, v in fields.items():
                setattr(job.view, k, v)
            job.view.updated_at = datetime.now(timezone.utc)

    async def heartbeat(self, job_id: str, *, phase: Phase, pct: int,
                        partial: Optional[List[Insight]] = None,
                        metrics_delta: Optional[Dict[str, int]] = None,
                        message: Optional[str] = None):
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job: raise KeyError(job_id)
            job.view.progress = JobProgress(phase=phase, pct=pct)
            if partial: job.view.partial_results = partial
            if metrics_delta:
                m = job.view.metrics
                for k, dv in metrics_delta.items():
                    setattr(m, k, getattr(m, k) + int(dv))
            if message:
                job.view.log = message
            job.view.updated_at = datetime.now(timezone.utc)

    async def complete(self, job_id: str, result: JobResult):
        await self.update(job_id, status=JobState.SUCCEEDED, result=result)

    async def fail(self, job_id: str, code: str, message: str):
        await self.update(job_id, status=JobState.FAILED, error={"code": code, "message": message})

    async def cancel(self, job_id: str):
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job: raise KeyError(job_id)
            job.cancel_event.set()
            job.view.status = JobState.CANCELLED
            job.view.updated_at = datetime.now(timezone.utc)

    async def is_cancelled(self, job_id: str) -> bool:
        job = await self.get(job_id)
        return job.cancel_event.is_set() if job else True

    async def evict_expired(self):
        async with self._lock:
            to_del = [jid for jid, j in self._jobs.items() if j.is_expired()]
            for jid in to_del:
                del self._jobs[jid]

job_store = JobStore()
router = APIRouter(
    prefix="/api/jobs",
    tags=["jobs"],
)

# ---- Status & Cancel Routes ---------------------------------------------------
@router.get("/{job_id}", response_model=JobView)
async def get_job_status(job_id: str):
    job_internal = await job_store.get(job_id)
    if not job_internal:
        # Check if it *was* a job that expired
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return job_internal.view

@router.post("/{job_id}/cancel", response_model=JobView)
async def cancel_job(job_id: str):
    try:
        await job_store.cancel(job_id)
        job = await job_store.get(job_id)
        if not job: raise KeyError()
        return job.view
    except KeyError:
        raise HTTPException(status_code=404, detail="Job not found")


@router.get("/{job_id}/events")
async def stream_job_events(job_id: str):
    """
    Server-Sent Events stream of job status snapshots.

    Emits 'data: {...}\n\n' JSON with the full JobView on each tick until terminal.
    """
    async def gen():
        last_payload = None
        while True:
            job = await job_store.get(job_id)
            if not job:
                # Not found or expired
                obj = {"error": "not_found", "job_id": job_id}
                yield f"data: {obj}\n\n"
                break

            view = job.view
            obj = view.model_dump()
            if obj != last_payload:
                last_payload = obj
                yield f"data: {obj}\n\n"

            if view.status in {JobState.SUCCEEDED, JobState.FAILED, JobState.CANCELLED}:
                break

            await asyncio.sleep(0.25)

    return StreamingResponse(gen(), media_type="text/event-stream")
