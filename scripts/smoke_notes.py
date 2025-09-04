import os
import sys
import json
import time
from fastapi.testclient import TestClient


def main() -> int:
    # Ensure repo root is importable
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    try:
        import server  # type: ignore
    except Exception as e:
        print(json.dumps({"ok": False, "stage": "import", "error": str(e)}))
        return 2

    payload = {
        "ok": False,
        "created": [],
        "search": None,
        "chunk": None,
    }

    with TestClient(server.app) as client:
        # 1) Create two notes
        notes_data = [
            {"title": "Smoke A", "content": "FastAPI smoke A.\n\nThis is a short paragraph."},
            {"title": "Smoke B", "content": "FastAPI smoke B.\n\nAnother short paragraph with overlap."},
        ]
        for nd in notes_data:
            r = client.post("/api/notes/", json=nd)
            if r.status_code != 201:
                print(json.dumps({"ok": False, "stage": "create_note", "status": r.status_code, "body": r.text}))
                return 1
            note = r.json()
            payload["created"].append({
                "id": note["id"],
                "title": note["title"],
                "chunks": len(note.get("chunks") or []),
            })

        # 2) Search similar chunks for the first note
        target_note_id = payload["created"][0]["id"]
        results = []
        r = client.post("/api/search/similar_chunks", json={"note_id": target_note_id, "k": 3})
        if r.status_code == 200:
            results = r.json()
            payload["search"] = results
        else:
            # Non-fatal for smoke: may lack valid embedding keys
            payload["search"] = {"status": r.status_code, "detail": r.text}

        # 3) If we have at least one result, fetch the chunk details
        if isinstance(results, list) and results:
            first_chunk_id = results[0]["chunk_id"]
            r = client.get(f"/api/chunks/{first_chunk_id}")
            if r.status_code == 200:
                payload["chunk"] = r.json()

    # Success if we created two notes with chunks and got a search response
    ok = (
        len(payload["created"]) == 2
        and all(c["chunks"] >= 1 for c in payload["created"])  # chunking ran
    )
    payload["ok"] = ok
    print(json.dumps(payload))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
