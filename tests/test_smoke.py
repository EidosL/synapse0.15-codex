import os
import time
import uuid as _uuid

import pytest
from fastapi.testclient import TestClient


def _setup_env(tmp_name: str = "test_smoke.db"):
    os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///./{tmp_name}")


def _patch_refiner(monkeypatch):
    # Patch refine_note and remove_note_from_index to avoid external calls
    import types

    async def _noop_refine(note, db):
        return None

    async def _noop_remove(note_id, db):
        return None

    import importlib
    notes_mod = importlib.import_module("src.api.notes")
    monkeypatch.setattr(notes_mod, "refine_note", _noop_refine, raising=True)
    monkeypatch.setattr(notes_mod, "remove_note_from_index", _noop_remove, raising=True)


def _client(monkeypatch):
    _setup_env()
    # Import server after env prepared
    import importlib
    server = importlib.import_module("server")
    return TestClient(server.app)


def test_health_ok(monkeypatch):
    client = _client(monkeypatch)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "ok"
    assert "llmConfigured" in data and "serpapiConfigured" in data and "agentscopeConfigured" in data


def test_notes_crud_smoke(monkeypatch):
    _patch_refiner(monkeypatch)
    client = _client(monkeypatch)

    # Create
    payload = {"title": "Test Note", "content": "Hello\n\nWorld"}
    r = client.post("/api/notes/", json=payload)
    assert r.status_code == 201, r.text
    created = r.json()
    nid = created["id"]

    # Read list
    r = client.get("/api/notes/")
    assert r.status_code == 200
    items = r.json()
    assert any(n["id"] == nid for n in items)

    # Read one
    r = client.get(f"/api/notes/{nid}")
    assert r.status_code == 200
    assert r.json()["title"] == "Test Note"

    # Update
    r = client.put(f"/api/notes/{nid}", json={"content": "Updated content"})
    assert r.status_code == 200
    assert "Updated" in r.json()["content"]

    # Delete
    r = client.delete(f"/api/notes/{nid}")
    assert r.status_code == 200
    # Ensure gone
    r = client.get(f"/api/notes/{nid}")
    assert r.status_code == 404


def test_generate_insights_background(monkeypatch):
    _patch_refiner(monkeypatch)
    # Patch pipeline to return instantly
    import types, importlib
    bp = importlib.import_module("src.backend_pipeline")

    class _Insight(dict):
        pass

    class _JobResult(dict):
        pass

    from src.jobs import JobResult, Insight

    async def _fake_run(inp, progress, db):
        res = JobResult(version="v2", insights=[Insight(insight_id="i1", title="Dummy", score=0.9)])
        return res

    monkeypatch.setattr(bp, "run_full_insight_pipeline", _fake_run, raising=True)

    client = _client(monkeypatch)

    # Create a note to serve as source
    r = client.post("/api/notes/", json={"title": "S", "content": "C"})
    assert r.status_code == 201
    nid = r.json()["id"]

    # Start job
    r = client.post("/api/generate-insights", json={"source_note_id": nid})
    assert r.status_code == 202, r.text
    job = r.json()

    # Poll until done
    for _ in range(40):
        s = client.get(f"/api/jobs/{job['job_id']}")
        assert s.status_code == 200
        st = s.json()
        if st["status"] == "SUCCEEDED":
            assert st["result"]["insights"][0]["title"] == "Dummy"
            break
        time.sleep(0.1)
    else:
        pytest.fail("Job did not complete in time")

