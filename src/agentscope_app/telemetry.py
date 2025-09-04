"""AgentScope tracing helpers with graceful fallback.

If AgentScope is not installed or tracing not configured, decorators are no-ops.
"""

from __future__ import annotations

from typing import Callable


def _noop_trace(name: str) -> Callable:
    def _decorator(func: Callable) -> Callable:
        return func
    return _decorator


try:
    # Vendored path is added during server startup; import may still fail in tests
    from agentscope.tracing import trace as _as_trace  # type: ignore
    trace = _as_trace  # type: ignore
except ImportError:
    # agentscope.tracing not available, fallback to no-op
    trace = _noop_trace  # type: ignore
except Exception as e:
    # Other errors, fallback and optionally log for debugging
    trace = _noop_trace  # type: ignore


__all__ = ["trace"]

