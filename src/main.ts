import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });

  // Allow all origins so MCP clients running locally can reach the server
  app.enableCors();

  await app.listen(PORT);
  logger.log(`MCP server running on http://localhost:${PORT}/mcp`);
  logger.log('Tools available: connect, get_evm_rep');
}

bootstrap();
