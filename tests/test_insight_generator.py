import pytest
from unittest.mock import AsyncMock, patch

from synapse.yaotong.tools.insight_generator import generate_insight


@pytest.mark.asyncio
@patch('synapse.yaotong.tools.insight_generator.generate_text', new_callable=AsyncMock)
async def test_generate_insight_structure(mock_generate_text):
    mock_generate_text.return_value = '{"core": "c", "rationale": "r", "uncertainty": ["u"]}'
    res = await generate_insight(["n1", "n2"], "instr")
    assert res.core == "c"
    assert res.rationale == "r"
    assert res.evidenceRefs == ["n1", "n2"]
    assert res.uncertainty == ["u"]
