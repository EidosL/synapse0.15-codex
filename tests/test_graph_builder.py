import pytest
from synapse.yaotong.models.recipe import Recipe, ProviderCfg
from synapse.yaotong.orchestrator.yaotong import YaoTong

@pytest.mark.asyncio
async def test_graph_builder_integration():
    recipe = Recipe(
        recipe_id="rcp_graph",
        providers={
            "retrieve": ProviderCfg(type="local"),
            "fusion_compose": ProviderCfg(type="local"),
            "graph_build": ProviderCfg(type="local"),
        }
    )
    yt = YaoTong(recipe)
    await yt.setup()
    result = await yt.run("Explore graphs", use_graph=True)
    graph = result["trace"].get("graph")
    assert isinstance(graph, dict)
    assert "nodes" in graph and "edges" in graph
