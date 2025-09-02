# synapse/yaotong/models/recipe.py
from pydantic import BaseModel, Field
from typing import Dict, Literal, Optional

class ProviderCfg(BaseModel):
    type: Literal["local","mcp"]
    server: Optional[str] = None
    tool: Optional[str] = None

class Recipe(BaseModel):
    """丹方配置模型 - 定义炼丹策略和参数"""
    recipe_id: str
    mode: Literal["pairwise","fusion"] = "fusion"
    
    # 核心炼丹参数
    notes_limit: int = Field(default=5, description="最多提取笔记数量")
    explore_depth: int = Field(default=1, description="探索深度，1=直接相关，2=二跳关联")
    use_graph: bool = Field(default=False, description="是否构建知识图谱")
    
    # 洞见生成配置
    summary_style: Literal["concise", "detailed", "analytical"] = Field(default="detailed")
    model: str = Field(default="gemini-1.5-pro", description="使用的LLM模型")
    citing: bool = Field(default=True, description="是否输出来源引用")
    
    # 原有配置保持兼容
    providers: Dict[str, ProviderCfg] = Field(default_factory=dict)
    toggles: Dict[str, bool] = Field(default_factory=dict)  # web, kg, redact
    roots: Dict[str, list] = Field(default_factory=dict)    # filesystem roots for MCP
    budgets: Dict[str, float] = Field(default_factory=dict) # time_sec/usd/tokens
    versions: Dict[str, str] = Field(default_factory=dict)  # embed,llm,etc.
    random_seed: int = 42

# 预置丹方模板
RECIPE_PRESETS = {
    "quick": {
        "recipe_id": "quick",
        "notes_limit": 3,
        "explore_depth": 1,
        "use_graph": False,
        "summary_style": "concise"
    },
    "comprehensive": {
        "recipe_id": "comprehensive", 
        "notes_limit": 8,
        "explore_depth": 2,
        "use_graph": True,
        "summary_style": "detailed"
    },
    "deep_analysis": {
        "recipe_id": "deep_analysis",
        "notes_limit": 10,
        "explore_depth": 3,
        "use_graph": True,
        "summary_style": "analytical"
    }
}

def get_preset_recipe(preset_name: str) -> Recipe:
    """获取预置丹方"""
    if preset_name not in RECIPE_PRESETS:
        raise ValueError(f"Unknown preset: {preset_name}. Available: {list(RECIPE_PRESETS.keys())}")
    return Recipe(**RECIPE_PRESETS[preset_name])
