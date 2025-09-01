# synapse/yaotong/tooling/base.py
from __future__ import annotations
from typing import Any, Dict, Optional, Protocol

class ToolHandle(Protocol):
    name: str
    provider: str  # "local" or "mcp:<server_id>"
    async def call(self, args: Dict[str, Any], timeout: Optional[float]=None) -> Dict[str, Any]: ...

class LocalTool:
    def __init__(self, name: str, fn):
        self.name = name
        self.provider = "local"
        self._fn = fn
    async def call(self, args, timeout=None):
        return await self._fn(**args) if hasattr(self._fn, "__call__") else await self._fn(args)

class MCPTool:
    def __init__(self, server_id: str, tool_name: str, mcp_client):
        self.name = tool_name
        self.provider = f"mcp:{server_id}"
        self._client = mcp_client
        self._server_id = server_id
    async def call(self, args, timeout=None):
        return await self._client.call_tool(self._server_id, self.name, args, timeout=timeout)
