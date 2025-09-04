from __future__ import annotations

import os
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from sqlalchemy.ext.asyncio import AsyncSession

from src.database.database import get_db
from src.synapse.yaotong.agents.prescriber import prescribe, Prescription
from src.synapse.yaotong.agents.planner import build_plan
from src.synapse.yaotong.orchestrator.yaotong import YaoTong
from src.synapse.yaotong.models.recipe import get_preset_recipe, Recipe


router = APIRouter(
    prefix="/api/yaotong",
    tags=["yaotong"],
)


class PrescribeRequest(BaseModel):
    goal: str
    capabilities: Dict[str, Any] = Field(default_factory=dict)
    budgets: Dict[str, Any] = Field(default_factory=dict)
    toggles: Dict[str, bool] = Field(default_factory=dict)
    project_doc: Optional[str] = None


class PrescribeResponse(BaseModel):
    prescription: Dict[str, Any]
    plan: Dict[str, Any]


@router.post("/prescribe", response_model=PrescribeResponse)
async def prescribe_endpoint(req: PrescribeRequest):
    rx: Prescription = await prescribe(
        goal=req.goal,
        project_capabilities=req.capabilities,
        user_budgets=req.budgets,
        toggles=req.toggles,
        project_doc=req.project_doc,
    )
    plan = await build_plan(rx)
    return PrescribeResponse(prescription=rx.model_dump(), plan=plan.model_dump())


class RunRequest(BaseModel):
    goal: str
    recipe_preset: Optional[str] = Field(default="quick")
    prescription: Optional[Dict[str, Any]] = None


class RunResponse(BaseModel):
    goal: str
    result: Dict[str, Any]


@router.post("/run", response_model=RunResponse)
async def run_endpoint(req: RunRequest):
    recipe: Recipe = get_preset_recipe(req.recipe_preset or "quick")
    yt = YaoTong(recipe)
    await yt.setup()
    p = None
    if req.prescription:
        try:
            p = Prescription.model_validate(req.prescription)
        except Exception:
            p = None
    out = await yt.run(req.goal, prescription_override=p)
    return RunResponse(goal=req.goal, result=out)
