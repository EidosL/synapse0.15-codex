import time
from typing import Optional, List, Dict
from src.jobs import JobStore, Phase, Insight

class ProgressReporter:
    def __init__(self, store: JobStore, job_id: str, t0: float):
        self._store = store
        self._job_id = job_id
        self._t0 = t0

    async def update(self, phase: Phase, pct: int,
                     partial: Optional[List[Insight]] = None,
                     metrics_delta: Optional[Dict[str, int]] = None):
        if metrics_delta is None:
            metrics_delta = {}

        # Always update elapsed time
        elapsed_ms = int((time.perf_counter() - self._t0) * 1000)
        metrics_delta["elapsed_ms"] = elapsed_ms

        await self._store.heartbeat(
            self._job_id,
            phase=phase,
            pct=pct,
            partial=partial,
            metrics_delta=metrics_delta
        )

    async def is_cancelled(self) -> bool:
        return await self._store.is_cancelled(self._job_id)
