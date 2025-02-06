import { IGitHubTokenManager } from '../../types/interfaces';
import { Octokit } from '@octokit/rest';
import logger from '../logger';

export class GitHubTokenManager implements IGitHubTokenManager {
  private tokens: string[];
  private currentTokenIndex: number;
  private octokit: Octokit;
  private rateLimitThreshold: number;

  constructor() {
    const primaryToken = process.env.GITHUB_PRIMARY_TOKEN;
    const backupTokens = process.env.GITHUB_BACKUP_TOKENS?.split(',') || [];
    
    if (!primaryToken) {
      throw new Error('GITHUB_PRIMARY_TOKEN is required');
    }

    this.tokens = [primaryToken, ...backupTokens.filter(Boolean)];
    this.currentTokenIndex = 0;
    this.rateLimitThreshold = parseInt(process.env.GITHUB_RATE_LIMIT_THRESHOLD || '1000', 10);
    this.octokit = new Octokit({ auth: this.tokens[0] });
  }

  async getToken(): Promise<string> {
    const { remaining } = await this.getRateLimitInfo();
    
    if (remaining <= this.rateLimitThreshold) {
      await this.rotateToken();
    }

    return this.tokens[this.currentTokenIndex];
  }

  async rotateToken(): Promise<void> {
    const startIndex = this.currentTokenIndex;
    let foundValidToken = false;

    do {
      this.currentTokenIndex = (this.currentTokenIndex + 1) % this.tokens.length;
      this.octokit = new Octokit({ auth: this.tokens[this.currentTokenIndex] });

      try {
        const { remaining, reset } = await this.getRateLimitInfo();
        if (remaining > this.rateLimitThreshold) {
          foundValidToken = true;
          logger.info('Rotated to new GitHub token', { 
            tokenIndex: this.currentTokenIndex,
            remaining,
            reset: reset.toISOString()
          });
          break;
        }
      } catch (error) {
        logger.error('Error checking rate limit for token', {
          error,
          tokenIndex: this.currentTokenIndex
        });
      }
    } while (this.currentTokenIndex !== startIndex);

    if (!foundValidToken) {
      throw new Error('No valid GitHub tokens available');
    }
  }

  async getRateLimitInfo(): Promise<{ remaining: number; reset: Date; limit: number }> {
    try {
      const { data } = await this.octokit.rateLimit.get();
      return {
        remaining: data.resources.core.remaining,
        reset: new Date(data.resources.core.reset * 1000),
        limit: data.resources.core.limit,
      };
    } catch (error) {
      logger.error('Failed to get rate limit info', { error });
      throw new Error('Failed to get rate limit info');
    }
  }
} 