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
   *  GET  /mcp  — SSE stream for server-initiated messages
   *  DELETE /mcp — session teardown
   */
  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    this.logger.debug(`${req.method} /mcp`);

    // Stateless transport: each HTTP call gets its own transport instance.
    // No persistent session state is kept between requests.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on('close', () => {
      transport.close().catch(() => {});
    });

    try {
      // Fresh server instance per request — required for stateless StreamableHTTP
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
