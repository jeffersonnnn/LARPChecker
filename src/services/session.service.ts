import fs from 'fs/promises';
import path from 'path';
import { ISessionService } from '../types/interfaces';
import logger from './logger';

export class SessionService implements ISessionService {
  private cookiesPath: string;
  private sessions: Map<string, { userId: string; createdAt: Date }>;

  constructor() {
    this.cookiesPath = path.join(process.env.STORAGE_PATH || './data', 'cookies.json');
    this.sessions = new Map();
  }

  // Session management methods
  async createSession(userId: string): Promise<string> {
    const sessionId = Math.random().toString(36).substring(2);
    this.sessions.set(sessionId, {
      userId,
      createdAt: new Date()
    });
    return sessionId;
  }

  async getSession(sessionId: string): Promise<{ userId: string; createdAt: Date } | null> {
    return this.sessions.get(sessionId) || null;
  }

  async invalidateSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async isValidSession(sessionId: string): Promise<boolean> {
    return this.sessions.has(sessionId);
  }

  // Cookie management methods
  async saveCookies(cookies: any): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.cookiesPath), { recursive: true });
      
      // Save cookies
      await fs.writeFile(
        this.cookiesPath,
        JSON.stringify(cookies, null, 2),
        'utf-8'
      );
      
      logger.info('Saved session cookies');
    } catch (error) {
      logger.error('Failed to save cookies:', error);
      throw new Error('Failed to save cookies');
    }
  }

  async loadCookies(): Promise<any> {
    try {
      const cookiesData = await fs.readFile(this.cookiesPath, 'utf-8');
      const cookies = JSON.parse(cookiesData);
      logger.info('Loaded session cookies');
      return cookies;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('No saved cookies found');
        return null;
      }
      logger.error('Failed to load cookies:', error);
      throw new Error('Failed to load cookies');
    }
  }

  async clearCookies(): Promise<void> {
    try {
      await fs.unlink(this.cookiesPath).catch(() => {});
      logger.info('Cleared session cookies');
    } catch (error) {
      logger.error('Failed to clear cookies:', error);
      throw new Error('Failed to clear cookies');
    }
  }
} 