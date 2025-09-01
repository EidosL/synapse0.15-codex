import asyncio, json, sys
from typing import Any, Dict

# NOTE: This is a minimal stub so tests don’t hang. Swap to the official MCP SDK later.

async def handle_request(req: Dict[str, Any]) -> Dict[str, Any]:
    mid = req.get("id")
    method = req.get("method")
    if method == "tools/list":
        return {"jsonrpc":"2.0","id":mid,"result":{
            "tools":[
                {"name":"synapse.retrieve","inputSchema":{"type":"object"}},
                {"name":"fusion.compose","inputSchema":{"type":"object"}}
            ]
        }}
    if method == "tools/call":
        params = req.get("params", {})
        name = params.get("name")
        args = params.get("arguments", {}) or {}
        if name == "synapse.retrieve":
            # return a deterministic, schema-shaped stub
            return {"jsonrpc":"2.0","id":mid,"result":{"content":{"hits":[{"note_id":"demo-1","score":0.91}]}}}
        if name == "fusion.compose":
            return {"jsonrpc":"2.0","id":mid,"result":{"content":{"pills":[]}}}
        return {"jsonrpc":"2.0","id":mid,"error":{"code":-32601,"message":f"Unknown tool {name}"}}
    return {"jsonrpc":"2.0","id":mid,"error":{"code":-32601,"message":"Unknown method"}}

async def stdio_server() -> None:
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    loop = asyncio.get_event_loop()
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)
    transport, protocol_w = await loop.connect_write_pipe(asyncio.StreamWriter, sys.stdout)
    writer = asyncio.StreamWriter(transport, protocol_w, reader, loop)

    while True:
        line = await reader.readline()
        if not line:
            break
        try:
            req = json.loads(line.decode().strip() or "{}")
            resp = await handle_request(req)
        except Exception as e:
            mid = req.get("id") if isinstance(req, dict) else None
            resp = {"jsonrpc":"2.0","id":mid,"error":{"code":-32000,"message":str(e)}}
        writer.write((json.dumps(resp) + "\n").encode())
        await writer.drain()

if __name__ == "__main__":
    asyncio.run(stdio_server())
