import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './tools.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const app = express();
app.use(express.json());
app.use(cors({ exposedHeaders: ['mcp-session-id'] }));

function createServer(): McpServer {
  const server = new McpServer({ name: 'rep-mcp-server', version: '1.0.0' });
  registerTools(server);
  return server;
}

// ─── Streamable HTTP transport (modern) ─────────────────────────
const httpTransports: Record<string, StreamableHTTPServerTransport> = {};

app.all('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  console.log(`[${req.method}] /mcp  session=${sessionId ?? '(none)'}  body.method=${req.body?.method ?? '-'}`);

  if (req.method === 'POST') {
    // Legacy SSE messages arrive with ?sessionId= query param
    const querySid = req.query.sessionId as string | undefined;
    if (querySid && sseTransports[querySid]) {
      console.log(`  [sse] handling message for SSE session ${querySid}`);
      await sseTransports[querySid].handlePostMessage(req, res, req.body);
      return;
    }

    if (sessionId && httpTransports[sessionId]) {
      await httpTransports[sessionId].handleRequest(req, res, req.body);
      return;
    }
    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          httpTransports[id] = transport;
          console.log(`  [streamable] session stored: ${id}`);
        },
        enableJsonResponse: true,
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) delete httpTransports[id];
      };
      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad request: no valid session or not an initialize request' },
      id: null,
    });
    return;
  }

  if (req.method === 'GET') {
    if (sessionId && httpTransports[sessionId]) {
      await httpTransports[sessionId].handleRequest(req, res);
      return;
    }
    // No session ID → treat as legacy SSE connection attempt
    console.log(`  [sse fallback] opening legacy SSE on /mcp`);
    const sseTransport = new SSEServerTransport('/mcp', res);
    const sseServer = createServer();
    await sseServer.connect(sseTransport);
    sseTransports[sseTransport.sessionId] = sseTransport;
    console.log(`  [sse fallback] session: ${sseTransport.sessionId}`);
    sseTransport.onclose = () => {
      delete sseTransports[sseTransport.sessionId];
    };
    return;
  }

  if (req.method === 'DELETE') {
    if (sessionId && httpTransports[sessionId]) {
      await httpTransports[sessionId].handleRequest(req, res);
      delete httpTransports[sessionId];
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

// ─── Legacy SSE transport (fallback for clients that don't support Streamable HTTP) ───
const sseTransports: Record<string, SSEServerTransport> = {};

app.get('/sse', async (_req, res) => {
  console.log(`[GET] /sse  -> new legacy SSE connection`);
  const transport = new SSEServerTransport('/messages', res);
  const server = createServer();
  await server.connect(transport);

  sseTransports[transport.sessionId] = transport;
  console.log(`  [sse] session: ${transport.sessionId}`);

  transport.onclose = () => {
    delete sseTransports[transport.sessionId];
    console.log(`  [sse] closed: ${transport.sessionId}`);
  };
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  console.log(`[POST] /messages  session=${sessionId}  body.method=${req.body?.method ?? '-'}`);

  const transport = sseTransports[sessionId];
  if (!transport) {
    res.status(400).json({ error: 'Unknown SSE session' });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

// ─── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`MCP server running on http://localhost:${PORT}`);
  console.log('  Streamable HTTP: POST/GET/DELETE /mcp');
  console.log('  Legacy SSE:      GET /sse + POST /messages');
  console.log('  Tools: connect, get_evm_rep');
});
