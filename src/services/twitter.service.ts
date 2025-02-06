import { Scraper, Tweet, Profile } from 'agent-twitter-client';
import { ITwitterService, ITwitterAuth, IMention, ISessionService } from '../types/interfaces';
import { SessionService } from './session.service';
import logger from './logger';

interface TwitterConfig {
  pollInterval: number;      // Interval between mention checks in ms
  maxRetries: number;        // Maximum number of retry attempts
  cacheTimeout: number;      // How long to cache processed mentions in ms
  backoffTime: number;       // Initial backoff time for rate limits in ms
  maxBackoffTime: number;    // Maximum backoff time for rate limits in ms
}

const DEFAULT_CONFIG: TwitterConfig = {
  pollInterval: 60000,           // 1 minute
  maxRetries: 3,                 // 3 retries
  cacheTimeout: 24 * 60 * 60 * 1000, // 24 hours
  backoffTime: 5000,             // 5 seconds
  maxBackoffTime: 900000,        // 15 minutes
};

export class TwitterService implements ITwitterService {
  private scraper: Scraper;
  private sessionService: ISessionService;
  private config: TwitterConfig;
  private isAuthenticated = false;
  private mentionCallbacks: ((mention: IMention) => Promise<void>)[] = [];
  private processedMentions = new Set<string>();
  private rateLimitDelay = 0;
  private pollInterval?: NodeJS.Timeout;
  private username?: string;
  private mentionCheckInterval?: NodeJS.Timeout;

  constructor(sessionService: ISessionService, config: Partial<TwitterConfig> = {}) {
    this.scraper = new Scraper();
    this.sessionService = sessionService;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.isAuthenticated) return;
    
    try {
      // Try to load existing session
      const cookies = await this.sessionService.loadCookies();
      if (cookies && Array.isArray(cookies)) {
        // Skip cookie initialization if no valid cookies found
        if (cookies.length > 0) {
          try {
            await this.scraper.setCookies(cookies);
            // Verify session is still valid
            const profile = await this.scraper.me();
            if (profile) {
              this.isAuthenticated = true;
              logger.info('Initialized Twitter service with saved session');
              return;
            }
          } catch (error) {
            logger.warn('Failed to restore Twitter session, will need to re-authenticate');
          }
        }
      }
      logger.info('No valid session found, waiting for authentication');
    } catch (error) {
      logger.error('Failed to initialize Twitter service:', error);
      // Don't throw here, just log and continue - we'll authenticate later
    }
  }

  async authenticate(auth: ITwitterAuth): Promise<void> {
    try {
      await this.scraper.login(auth.username, auth.password);
      this.isAuthenticated = true;

      // Save new session
      const newCookies = await this.scraper.getCookies();
      await this.sessionService.saveCookies(newCookies);
      
      logger.info('Authenticated with Twitter', { username: auth.username });

      // Start mention listener now that we're authenticated
      await this.startMentionListener();
    } catch (error) {
      logger.error('Authentication failed:', error);
      throw new Error('Failed to authenticate with Twitter');
    }
  }

  async tweet(content: string, replyToId?: string): Promise<string> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated with Twitter');
    }

    let retries = 0;
    while (retries < this.config.maxRetries) {
      try {
        await this.handleRateLimit();
        const result = await this.scraper.sendTweetV2(content, replyToId);
        if (!result?.id) {
          throw new Error('Failed to get tweet ID from response');
        }

        this.rateLimitDelay = 0; // Reset backoff on success
        logger.info('Tweet posted successfully', { replyToId });
        return result.id;
      } catch (error) {
        if (this.isSessionError(error)) {
          await this.handleSessionError();
        } else if (this.isRateLimitError(error)) {
          await this.handleRateLimit(error);
        } else {
          retries++;
          if (retries === this.config.maxRetries) {
            logger.error('Failed to post tweet after retries:', error);
            throw new Error('Failed to post tweet');
          }
          await new Promise(resolve => setTimeout(resolve, this.config.backoffTime * retries));
        }
      }
    }
    throw new Error('Failed to post tweet after retries');
  }

  async reply(mention: IMention, content: string): Promise<void> {
    await this.tweet(content, mention.id);
  }

  onMention(callback: (mention: IMention) => Promise<void>): void {
    this.mentionCallbacks.push(callback);
    this.startMentionListener();
  }

  listenForMentions(callback: (mention: IMention) => Promise<void>): void {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated with Twitter');
    }

    this.mentionCallbacks.push(callback);
    this.startMentionListener();
    logger.info('Started listening for mentions');
  }

  stopListening(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
      logger.info('Stopped listening for mentions');
    }
  }

  async startMentionListener(): Promise<void> {
    try {
      if (!this.isAuthenticated) {
        logger.info('Twitter service not authenticated yet, mention listener will start after authentication');
        return;
      }

      // Get our own username to filter mentions
      const profile = await this.scraper.me();
      if (!profile) {
        logger.warn('Could not get profile username, mention listener will start after authentication');
        return;
      }

      this.username = profile.username;
      logger.info(`Starting mention listener for @${this.username}`);

      // Start polling for mentions
      this.mentionCheckInterval = setInterval(async () => {
        try {
          await this.checkMentions();
        } catch (error) {
          logger.error('Error checking mentions:', error);
        }
      }, this.config.pollInterval);

    } catch (error) {
      logger.error('Error starting mention listener:', error);
      // Don't throw, just log the error
    }
  }

  private async processMention(tweet: Tweet, profile: Profile): Promise<void> {
    if (!this.isValidTweet(tweet) || !tweet.id || this.processedMentions.has(tweet.id)) {
      return;
    }

    try {
      if (tweet.text && profile.username &&
          tweet.text.includes('@' + profile.username) && 
          tweet.text.includes('github.com')) {
        
        const mention: IMention = {
          id: tweet.id,
          text: tweet.text,
          author: tweet.username || tweet.name || 'unknown',
          repositoryUrl: this.extractGitHubUrl(tweet.text),
        };

        // Process mention through all registered callbacks
        for (const callback of this.mentionCallbacks) {
          try {
            await callback(mention);
          } catch (error) {
            logger.error('Error in mention callback:', error);
          }
        }

        // Cache the processed mention ID
        this.processedMentions.add(tweet.id);
        setTimeout(() => {
          if (tweet.id) {
            this.processedMentions.delete(tweet.id);
          }
        }, this.config.cacheTimeout);
      }
    } catch (error) {
      logger.error('Error processing mention:', error);
    }
  }

  private isValidTweet(tweet: Tweet): tweet is Tweet {
    return Boolean(
      tweet &&
      tweet.id &&
      tweet.text &&
      (tweet.username || tweet.name)
    );
  }

  private extractGitHubUrl(text: string): string | undefined {
    const githubUrlRegex = /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+/;
    const match = text.match(githubUrlRegex);
    return match ? match[0] : undefined;
  }

  private isSessionError(error: any): boolean {
    return error?.message?.includes('session') || 
           error?.message?.includes('authentication') ||
           error?.message?.includes('login');
  }

  private isRateLimitError(error: any): boolean {
    return error?.message?.includes('rate limit') ||
           error?.message?.includes('too many requests');
  }

  private async handleRateLimit(error?: any): Promise<void> {
    if (error) {
      this.rateLimitDelay = Math.min(
        this.rateLimitDelay + this.config.backoffTime,
        this.config.maxBackoffTime
      );
      logger.warn('Rate limit hit, backing off for', { delay: this.rateLimitDelay });
    }

    if (this.rateLimitDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
    }
  }

  private async handleSessionError(): Promise<void> {
    logger.info('Session expired, clearing cookies');
    await this.sessionService.clearCookies();
    this.isAuthenticated = false;
    throw new Error('Session expired, please authenticate again');
  }

  private async checkMentions(): Promise<void> {
    if (!this.username || !this.isAuthenticated) return;

    await this.handleRateLimit();
    const tweetsGenerator = await this.scraper.getTweetsAndReplies(this.username, 10);
    const tweets = [];
    
    for await (const tweet of tweetsGenerator) {
      if (this.isValidTweet(tweet)) {
        tweets.push(tweet);
      }
    }
    
    const profile = await this.scraper.me();
    if (!profile) {
      logger.warn('Could not get profile for processing mentions');
      return;
    }

    for (const tweet of tweets) {
      await this.processMention(tweet, profile);
    }
  }

  private stopMentionListener(): void {
    if (this.mentionCheckInterval) {
      clearInterval(this.mentionCheckInterval);
      this.mentionCheckInterval = undefined;
    }
  }
} 