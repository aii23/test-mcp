import { All, Controller, Logger, Req, Res } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { McpService } from './mcp.service';

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly mcpService: McpService) {}

  /**
   * Single endpoint that handles all MCP traffic (stateful mode):
   *  POST /mcp   — JSON-RPC request/response (initialize creates a session)
   *  GET  /mcp   — SSE stream for server-initiated messages
   *  DELETE /mcp  — session teardown
   */
  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    this.logger.debug(`${req.method} /mcp  session=${sessionId ?? '(none)'}`);

    if (req.method === 'POST') {
      await this.handlePost(req, res, sessionId);
    } else if (req.method === 'GET') {
      await this.handleGet(req, res, sessionId);
    } else if (req.method === 'DELETE') {
      await this.handleDelete(req, res, sessionId);
    } else {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      });
    }
  }

  private async handlePost(req: Request, res: Response, sessionId: string | undefined): Promise<void> {
    // Existing session — reuse its transport
    if (sessionId && this.sessions.has(sessionId)) {
      const { transport } = this.sessions.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session (initialize request)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = this.mcpService.createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    // The transport assigns a session ID during the initialize handshake
    const newId = transport.sessionId;
    if (newId) {
      this.sessions.set(newId, { transport, server });
      this.logger.log(`Session created: ${newId}`);

      transport.onclose = () => {
        this.sessions.delete(newId);
        this.logger.log(`Session closed: ${newId}`);
      };
    }
  }

  private async handleGet(req: Request, res: Response, sessionId: string | undefined): Promise<void> {
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid or missing session ID.' },
        id: null,
      });
      return;
    }
    await session.transport.handleRequest(req, res);
  }

  private async handleDelete(req: Request, res: Response, sessionId: string | undefined): Promise<void> {
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid or missing session ID.' },
        id: null,
      });
      return;
    }
    await session.transport.handleRequest(req, res);
    this.sessions.delete(sessionId!);
    await session.server.close();
    this.logger.log(`Session deleted: ${sessionId}`);
  }
}
