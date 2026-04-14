import { Injectable, Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodRawShape } from 'zod';
import { z } from 'zod';

const FUNNY_QUOTES_BY_TIER: Record<string, string[]> = {
  legendary: [
    'They say this wallet was born with a golden private key.',
    'Not just a whale — this address IS the ocean.',
    'Satoshi himself checks this wallet for inspiration.',
    'When this address buys, the market follows.',
  ],
  chad: [
    'Bought ETH at $5. Still HODLing. No regrets.',
    'Gas fees are just a rounding error to this address.',
    'This wallet diversified before diversification was cool.',
    'Rugged twice, came back stronger both times.',
  ],
  normie: [
    'Found crypto during a bull run. Missing the bear run. Classic.',
    'Holds a bag of 47 different shitcoins, none in profit.',
    'Has read the Bitcoin whitepaper... the first two pages.',
    'Sends ETH to wrong address once per quarter, like clockwork.',
  ],
  degen: [
    "YOLO'd life savings into a coin named after a dog of a dog.",
    'Portfolio is 99% unrealized losses, 1% unrealized cope.',
    'Once swapped ETH for a token that rugged in 6 minutes.',
    'Tax form? Never heard of it.',
  ],
  ngmi: [
    'Sold BTC at $3 to buy concert tickets. Worth it? Still unsure.',
    'Clicked "approve" on a contract that was literally named STEAL_ALL.',
    'This address has been rekt so hard it earned a PhD in it.',
    'The only thing this wallet pumps is the gas fees on failed txns.',
  ],
};

function getTier(score: number): string {
  if (score >= 85) return 'legendary';
  if (score >= 65) return 'chad';
  if (score >= 40) return 'normie';
  if (score >= 20) return 'degen';
  return 'ngmi';
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor() {
    this.logger.log('McpService ready — tools: connect, get_evm_rep');
  }

  /**
   * Creates a fresh McpServer instance with all tools registered.
   *
   * IMPORTANT: StreamableHTTPServerTransport (stateless mode) requires a
   * separate Protocol/McpServer instance per request — a single instance
   * cannot be connected to more than one transport at a time.
   */
  createServer(): McpServer {
    const server = new McpServer({
      name: 'nest-mcp-server',
      version: '1.0.0',
    });

    // Tool 1: connect — just say hi
    server.tool(
      'connect',
      'Ping the MCP server. Returns a friendly greeting.',
      {},
      async () => ({
        content: [
          {
            type: 'text' as const,
            text: 'Hi! 👋  I am your NestJS MCP server. Ready to serve.',
          },
        ],
      }),
    );

    // Tool 2: get_evm_rep — random score + tier + funny quote
    const evmRepSchema = {
      address: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address (0x + 40 hex chars)')
        .describe('EVM wallet address to look up'),
    } satisfies ZodRawShape;

    // @ts-ignore – TS2589: chained Zod (.regex().describe()) exceeds TS inference depth limit
    server.tool(
      'get_evm_rep',
      'Returns a random on-chain reputation score and a funny quote for the given EVM address.',
      evmRepSchema,
      async ({ address }) => {
        const score = Math.floor(Math.random() * 101); // 0–100
        const tier = getTier(score);
        const quote = pickRandom(FUNNY_QUOTES_BY_TIER[tier]);

        const tierEmoji: Record<string, string> = {
          legendary: '🏆',
          chad: '💪',
          normie: '😐',
          degen: '🎰',
          ngmi: '💀',
        };

        const text = [
          `📬 Address : ${address}`,
          `⭐ Rep score: ${score} / 100`,
          `🏷️  Tier     : ${tierEmoji[tier]} ${tier.toUpperCase()}`,
          ``,
          `"${quote}"`,
        ].join('\n');

        return { content: [{ type: 'text' as const, text }] };
      },
    );

    return server;
  }
}
