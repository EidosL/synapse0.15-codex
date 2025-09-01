import pytest
from synapse.yaotong.models.recipe import Recipe
from synapse.yaotong.orchestrator.yaotong import YaoTong, LongTermMemory


@pytest.mark.asyncio
async def test_long_term_memory_persists(tmp_path):
    recipe = Recipe(recipe_id="rcp_memory")
    mem_path = tmp_path / "memory.json"
    memory = LongTermMemory(mem_path)
    yt = YaoTong(recipe, memory_store=memory)
    await yt.setup()
    first = await yt.run("quantum computing")
    assert first["pills"]

    # new orchestrator instance simulating a new request
    yt2 = YaoTong(recipe, memory_store=LongTermMemory(mem_path))
    await yt2.setup()
    second = await yt2.run("quantum computing")
    assert second["context"] == first["pills"]
