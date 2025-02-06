import '@jest/globals';
import { config } from 'dotenv';
import path from 'path';

// Load environment variables from .env file
config({ path: path.join(__dirname, '../../.env') });

// Global test timeout
jest.setTimeout(30000);

// Mock console methods to keep test output clean
global.console = {
  ...console,
  // log: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Clean up function to run after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Mock services that shouldn't make real API calls during tests
jest.mock('../services/twitter.service');
jest.mock('../services/github.service');
jest.mock('../services/ai.service');

// Export setup function for use in tests
export const setupTest = () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
}; 
