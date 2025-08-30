import pytest
from synapse.yaotong.models.recipe import Recipe, ProviderCfg
from synapse.yaotong.orchestrator.yaotong import YaoTong

@pytest.mark.asyncio
async def test_min_fusion_flow():
    recipe = Recipe(
        recipe_id="rcp_demo",
        providers={
            "retrieve": ProviderCfg(type="local"),
            "fusion_compose": ProviderCfg(type="local"),
        }
    )
    yt = YaoTong(recipe)
    await yt.setup()
    result = await yt.run("Relation between transformers and graph reasoning")
    assert "pills" in result and isinstance(result["pills"], list)
