import pytest
from synapse.yaotong.models.recipe import Recipe, ProviderCfg
from synapse.yaotong.orchestrator.yaotong import YaoTong

@pytest.mark.asyncio
async def test_local_tools_resolve():
    recipe = Recipe(
        recipe_id="rcp_local_only",
        providers={
            "retrieve": ProviderCfg(type="local"),
            "fusion_compose": ProviderCfg(type="local"),
        }
    )
    yt = YaoTong(recipe)
    await yt.setup()
    assert yt.tools["retrieve"].provider == "local"
    assert yt.tools["fusion_compose"].provider == "local"

@pytest.mark.asyncio
async def test_mcp_handle_resolves_without_calling():
    recipe = Recipe(
        recipe_id="rcp_mcp",
        providers={
            "retrieve": ProviderCfg(type="mcp", server="synapse", tool="synapse.retrieve"),
            "fusion_compose": ProviderCfg(type="local"),
        }
    )
    yt = YaoTong(recipe)
    await yt.setup()
    assert yt.tools["retrieve"].provider.startswith("mcp:")
