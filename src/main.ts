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

app.all('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  console.log(`[${req.method}] session=${sessionId ?? '(none)'}  body.method=${req.body?.method ?? '-'}`);

  // --- POST ---
  if (req.method === 'POST') {
    // Existing session
    if (sessionId && transports[sessionId]) {
      console.log(`  -> reusing session ${sessionId}`);
      await transports[sessionId].handleRequest(req, res, req.body);
      return;
    }

    // New session — only for initialize
    if (!sessionId && isInitializeRequest(req.body)) {
      console.log(`  -> creating new session`);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport;
          console.log(`  -> session stored: ${id}`);
        },
        enableJsonResponse: true,
      });

      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) delete transports[id];
      };

      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    console.log(`  -> rejected: no session match, not initialize`);
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad request: no valid session or not an initialize request' },
      id: null,
    });
    return;
  }

  // --- GET (SSE) ---
  if (req.method === 'GET') {
    if (sessionId && transports[sessionId]) {
      console.log(`  -> opening SSE for session ${sessionId}`);
      await transports[sessionId].handleRequest(req, res);
      return;
    }
    console.log(`  -> GET rejected: no session`);
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid or missing session ID.' },
      id: null,
    });
    return;
  }

  // --- DELETE ---
  if (req.method === 'DELETE') {
    if (sessionId && transports[sessionId]) {
      console.log(`  -> deleting session ${sessionId}`);
      await transports[sessionId].handleRequest(req, res);
      delete transports[sessionId];
      return;
    }
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid or missing session ID.' },
      id: null,
    });
    return;
  }

  res.status(405).end('Method Not Allowed');
});

app.listen(PORT, () => {
  console.log(`MCP server running on http://localhost:${PORT}/mcp`);
  console.log('Tools: connect, get_evm_rep');
});
