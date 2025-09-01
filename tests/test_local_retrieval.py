import types
import pytest

import synapse.yaotong.tools.local_retrieval as lr


class DummySession:
    async def __aenter__(self):
        return None

    async def __aexit__(self, exc_type, exc, tb):
        pass


@pytest.mark.asyncio
async def test_retrieve_tool_format(monkeypatch):
    # Stub database session and note fetching
    monkeypatch.setattr(lr.database, "SessionLocal", lambda: DummySession())

    async def fake_get_notes(db, limit=1000):
        return [types.SimpleNamespace(id="n1", title="note", content="text")]

    async def fake_retrieve_candidate_notes(queries, db, all_notes, exclude_note_id, top_k):
        return ["n1", "n2"]

    monkeypatch.setattr(lr.crud, "get_notes", fake_get_notes)
    monkeypatch.setattr(lr, "retrieve_candidate_notes", fake_retrieve_candidate_notes)

    result = await lr.retrieve_tool("query", top_k=2)
    assert "hits" in result
    hits = result["hits"]
    assert isinstance(hits, list) and len(hits) == 2
    for h in hits:
        assert "note_id" in h and "score" in h
