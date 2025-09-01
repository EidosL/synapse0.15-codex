# synapse/yaotong/models/recipe.py
from pydantic import BaseModel, Field
from typing import Dict, Literal, Optional

class ProviderCfg(BaseModel):
    type: Literal["local","mcp"]
    server: Optional[str] = None
    tool: Optional[str] = None

class Recipe(BaseModel):
    recipe_id: str
    mode: Literal["pairwise","fusion"] = "fusion"
    providers: Dict[str, ProviderCfg] = Field(default_factory=dict)
    toggles: Dict[str, bool] = Field(default_factory=dict)  # web, kg, redact
    roots: Dict[str, list] = Field(default_factory=dict)    # filesystem roots for MCP
    budgets: Dict[str, float] = Field(default_factory=dict) # time_sec/usd/tokens
    versions: Dict[str, str] = Field(default_factory=dict)  # embed,llm,etc.
    random_seed: int = 42
