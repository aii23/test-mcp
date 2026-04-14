import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './tools.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const app = express();
app.use(express.json());
app.use(cors({ exposedHeaders: ['mcp-session-id'] }));

const transports: Record<string, StreamableHTTPServerTransport> = {};

function createServer(): McpServer {
  const server = new McpServer({ name: 'rep-mcp-server', version: '1.0.0' });
  registerTools(server);
  return server;
}

// --- POST /mcp — JSON-RPC requests ---
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Existing session
  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res, req.body);
    return;
  }

  // New session — only valid for initialize requests
  if (!sessionId && isInitializeRequest(req.body)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport;
        console.log(`Session created: ${id}`);
      },
    });

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id && transports[id]) {
        delete transports[id];
        console.log(`Session closed: ${id}`);
      }
    };

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Bad request: no valid session or missing initialize' },
    id: null,
  });
});

// --- GET /mcp — SSE stream for server-initiated messages ---
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res);
    return;
  }
  res.status(400).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Invalid or missing session ID.' },
    id: null,
  });
});

// --- DELETE /mcp — session teardown ---
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res);
    delete transports[sessionId];
    return;
  }
  res.status(400).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Invalid or missing session ID.' },
    id: null,
  });
});

app.listen(PORT, () => {
  console.log(`MCP server running on http://localhost:${PORT}/mcp`);
  console.log('Tools available: connect, get_evm_rep');
});
