import dotenv from 'dotenv';
import { LARPCheckApp } from './app';
import logger from './services/logger';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'GITHUB_TOKEN',
  'OPENAI_API_KEY',
  'TWITTER_USERNAME',
  'TWITTER_PASSWORD'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const app = new LARPCheckApp();

  try {
    await app.start({
      username: process.env.TWITTER_USERNAME!,
      password: process.env.TWITTER_PASSWORD!,
    });

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM signal. Shutting down...');
      await app.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT signal. Shutting down...');
      await app.stop();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

main(); 