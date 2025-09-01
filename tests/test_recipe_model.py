from synapse.yaotong.models.recipe import Recipe


def test_recipe_defaults_and_serialization():
    recipe = Recipe(recipe_id="demo")
    assert recipe.notes_limit == 5
    assert recipe.explore_depth == 1
    assert recipe.use_graph is False
    dumped = recipe.model_dump()
    assert dumped["notes_limit"] == 5
    assert dumped["explore_depth"] == 1
    assert dumped["use_graph"] is False


def test_recipe_top_k_backward_compatibility():
    recipe = Recipe(recipe_id="legacy", top_k=7, use_graph=True, explore_depth=2)
    assert recipe.notes_limit == 7
    assert recipe.use_graph is True
    assert recipe.explore_depth == 2
    dumped = recipe.model_dump()
    assert dumped["notes_limit"] == 7
    assert "top_k" not in dumped
