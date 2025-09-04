from __future__ import annotations

from fastapi import APIRouter
from src.agentscope_app.metrics.usage import snapshot

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/llm-usage")
async def llm_usage():
    return snapshot(reset=False)

