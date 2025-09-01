# synapse/yaotong/models/recipe.py
from pydantic import BaseModel, Field
from typing import Dict, Literal, Optional

class ProviderCfg(BaseModel):
    type: Literal["local", "mcp"]
    server: Optional[str] = None
    tool: Optional[str] = None

class Recipe(BaseModel):
    """Execution configuration for a YaoTong run."""

    recipe_id: str = Field(..., description="Unique identifier for this recipe")
    mode: Literal["pairwise", "fusion"] = Field(
        "fusion", description="Orchestration mode for the pipeline"
    )
    providers: Dict[str, ProviderCfg] = Field(
        default_factory=dict, description="Tool provider configurations"
    )
    toggles: Dict[str, bool] = Field(
        default_factory=dict, description="Feature toggles such as web, kg, redact"
    )
    roots: Dict[str, list] = Field(
        default_factory=dict, description="Filesystem roots for MCP servers"
    )
    budgets: Dict[str, float] = Field(
        default_factory=dict, description="Resource budgets (time_sec/usd/tokens)"
    )
    versions: Dict[str, str] = Field(
        default_factory=dict, description="Component versions (embed, llm, etc.)"
    )
    random_seed: int = Field(42, description="Random seed for reproducibility")
    notes_limit: int = Field(5, description="Maximum number of notes to retrieve")
    explore_depth: int = Field(1, description="Depth of exploration iterations")
    use_graph: bool = Field(
        False, description="Whether to trigger the graph module in the pipeline"
    )

    def __init__(self, **data):
        # Maintain backwards compatibility with previous `top_k` field.
        if "top_k" in data and "notes_limit" not in data:
            data["notes_limit"] = data.pop("top_k")
        super().__init__(**data)
