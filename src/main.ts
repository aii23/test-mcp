import express, { Request, Response } from 'express';
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

// ─── OAuth discovery (Cursor probes this; fast 404 → empty response) ────
app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.status(404).json({ error: 'OAuth not supported' });
});

// ─── SSE session store (shared by /mcp fallback and /sse) ───────────────
const sseTransports: Record<string, SSEServerTransport> = {};

function setupSse(messagePath: string, res: Response): void {
  // Prevent proxy/CDN buffering — critical for Railway/Fastly
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const transport = new SSEServerTransport(messagePath, res);
  const server = createServer();

  sseTransports[transport.sessionId] = transport;
  console.log(`  [sse] session: ${transport.sessionId}`);

  transport.onclose = () => {
    delete sseTransports[transport.sessionId];
    console.log(`  [sse] closed: ${transport.sessionId}`);
  };

  server.connect(transport).catch((err) => {
    console.error('SSE connect error:', err);
  });
}

// ─── Streamable HTTP transport (modern) ─────────────────────────────────
const httpTransports: Record<string, StreamableHTTPServerTransport> = {};

app.all('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  console.log(`[${req.method}] /mcp  session=${sessionId ?? '(none)'}  query.sessionId=${req.query.sessionId ?? '-'}  body.method=${req.body?.method ?? '-'}`);

  if (req.method === 'POST') {
    // Legacy SSE messages arrive with ?sessionId= query param
    const querySid = req.query.sessionId as string | undefined;
    if (querySid && sseTransports[querySid]) {
      console.log(`  [sse] POST for session ${querySid}`);
      await sseTransports[querySid].handlePostMessage(req, res, req.body);
      return;
    }

    // Streamable HTTP — existing session
    if (sessionId && httpTransports[sessionId]) {
      await httpTransports[sessionId].handleRequest(req, res, req.body);
      return;
    }

    // Streamable HTTP — new session (initialize only)
    if (!sessionId && isInitializeRequest(req.body)) {
      console.log(`  [streamable] creating new session`);
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
    // Streamable HTTP SSE (has session header)
    if (sessionId && httpTransports[sessionId]) {
      await httpTransports[sessionId].handleRequest(req, res);
      return;
    }
    // Legacy SSE fallback (no session header)
    console.log(`  [sse fallback] on /mcp`);
    setupSse('/mcp', res);
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

// ─── Legacy SSE at /sse + /messages (for base-URL configs) ──────────────
app.get('/sse', (_req: Request, res: Response) => {
  console.log(`[GET] /sse`);
  setupSse('/messages', res);
});

app.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  console.log(`[POST] /messages  session=${sessionId}  body.method=${req.body?.method ?? '-'}`);
  const transport = sseTransports[sessionId];
  if (!transport) {
    res.status(400).json({ error: 'Unknown SSE session' });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

// ─── Start ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`MCP server listening on port ${PORT}`);
  console.log('  Streamable HTTP: POST/GET/DELETE /mcp');
  console.log('  Legacy SSE:      GET /sse + POST /messages (or GET /mcp + POST /mcp?sessionId=)');
  console.log('  Tools: connect, get_evm_rep');
});
