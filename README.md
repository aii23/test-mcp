# NestJS MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server built with NestJS.  
Uses **StreamableHTTP** transport — works with any MCP client that supports the 2025-03-26 protocol revision.

## Tools

| Tool | Description |
|---|---|
| `connect` | Ping the server — just says Hi |
| `get_evm_rep` | Returns a random reputation score (0–100), tier, and funny quote for an EVM address |

## Getting started

```bash
cp .env.example .env
npm install
npm run start:dev    # dev with watch
# or
npm run build && npm start  # production
```

Server listens on `http://localhost:3000/mcp` by default.

## MCP client config (Cursor / Claude Desktop)

```json
{
  "mcpServers": {
    "nest-mcp": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Example requests

**connect**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"connect","arguments":{}}}'
```

**get_evm_rep**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0","id":2,
    "method":"tools/call",
    "params":{
      "name":"get_evm_rep",
      "arguments":{"address":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"}
    }
  }'
```
