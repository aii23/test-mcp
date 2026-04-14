import { All, Controller, Logger, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { McpService } from './mcp.service';

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly mcpService: McpService) {}

  /**
   * Single endpoint that handles all MCP traffic:
   *  POST /mcp  — JSON-RPC request/response
   *  GET  /mcp  — rejected (stateless mode, no SSE)
   *  DELETE /mcp — rejected (stateless mode, no sessions)
   */
  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    this.logger.debug(`${req.method} /mcp`);

    // Stateless mode: only POST is valid. GET (SSE) and DELETE (session
    // teardown) are not supported — return 405 so MCP clients fall back
    // to POST-only communication immediately instead of hanging.
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on('close', () => {
      transport.close().catch(() => {});
    });

    try {
      const server = this.mcpService.createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error('Error handling MCP request', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal MCP error' });
      }
    }
  }
}
