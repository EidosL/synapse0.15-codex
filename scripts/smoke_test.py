import os
import sys
import json
from fastapi.testclient import TestClient


def main() -> int:
    # Ensure repo root is on sys.path so `import server` works
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    try:
        import server  # type: ignore
    except Exception as e:
        print(json.dumps({
            "ok": False,
            "stage": "import",
            "error": f"Failed to import server: {e}"
        }))
        return 2

    try:
        with TestClient(server.app) as client:
            res = client.get("/api/health")
            payload = res.json()
            ok = res.status_code == 200 and payload.get("status") == "ok"
            print(json.dumps({
                "ok": ok,
                "status_code": res.status_code,
                "payload": payload,
            }))
            return 0 if ok else 1
    except Exception as e:
        print(json.dumps({
            "ok": False,
            "stage": "request",
            "error": str(e)
        }))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())

