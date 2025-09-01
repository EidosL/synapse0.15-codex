from synapse.yaotong.models.fusion import Hypothesis, FusionInsight

def test_fusion_models_roundtrip():
    h = Hypothesis(
        id="h1",
        statement="Test statement",
        facets=["f1"],
        conflicts=[],
        supportScore=0.5, noveltyScore=0.1, coherenceScore=0.8
    )
    p = FusionInsight(
        id="pill-1", role="Base",
        core="Core", rationale="From facets f1",
        hypotheses=[h.id], evidenceRefs=h.facets,
        confidence=0.75, uncertainty=[]
    )
    assert p.model_dump()["role"] == "Base"
