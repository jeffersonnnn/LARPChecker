import { LARPCheckApp } from './app';
import { config } from 'dotenv';
import path from 'path';
import logger from './services/logger';

// Load environment variables
config({ path: path.join(__dirname, '../.env') });

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

logger.info('Starting app with Twitter credentials', {
  username: process.env.TWITTER_USERNAME,
  hasPassword: Boolean(process.env.TWITTER_PASSWORD)
});

const app = new LARPCheckApp();

// Start the application with Twitter credentials from environment variables
app.start({
  username: process.env.TWITTER_USERNAME!,
  password: process.env.TWITTER_PASSWORD!
}).catch(error => {
  logger.error('Failed to start application:', error);
  process.exit(1);
});

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal. Shutting down...');
  await app.stop();
  process.exit(0);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal. Shutting down...');
  await app.stop();
  process.exit(0);
}); 