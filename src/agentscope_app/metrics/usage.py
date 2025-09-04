from __future__ import annotations

import threading
from typing import Any, Dict

_lock = threading.Lock()
_usage: Dict[str, Any] = {
    "calls": 0,
    "providers": {},  # provider -> {models: {model: {...}}, totals: {...}}
}


def _ensure_provider(provider: str) -> Dict[str, Any]:
    p = _usage["providers"].setdefault(provider, {"models": {}, "totals": {"input_tokens": 0, "output_tokens": 0, "time_sec": 0.0, "calls": 0}})
    return p


def record_call(provider: str, model: str, input_tokens: int | None, output_tokens: int | None, time_sec: float | None) -> None:
    with _lock:
        _usage["calls"] += 1
        p = _ensure_provider(provider)
        m = p["models"].setdefault(model, {"input_tokens": 0, "output_tokens": 0, "time_sec": 0.0, "calls": 0})
        m["calls"] += 1
        p["totals"]["calls"] += 1
        if input_tokens is not None:
            m["input_tokens"] += int(input_tokens)
            p["totals"]["input_tokens"] += int(input_tokens)
        if output_tokens is not None:
            m["output_tokens"] += int(output_tokens)
            p["totals"]["output_tokens"] += int(output_tokens)
        if time_sec is not None:
            m["time_sec"] += float(time_sec)
            p["totals"]["time_sec"] += float(time_sec)


def snapshot(reset: bool = False) -> Dict[str, Any]:
    with _lock:
        import copy
        data = copy.deepcopy(_usage)
        if reset:
            _usage["calls"] = 0
            _usage["providers"] = {}
        return data

