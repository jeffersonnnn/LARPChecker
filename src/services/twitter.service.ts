import { Scraper, Tweet, Profile, SearchMode } from 'agent-twitter-client';
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
      logger.info('Starting Twitter authentication', { username: auth.username });
      await this.scraper.login(auth.username, auth.password);
      this.isAuthenticated = true;

      // Save new session
      const newCookies = await this.scraper.getCookies();
      logger.info('Got new cookies from Twitter', { cookieCount: newCookies.length });
      await this.sessionService.saveCookies(newCookies);
      
      logger.info('Authenticated with Twitter', { username: auth.username });

      // Get profile to verify authentication
      const profile = await this.scraper.me();
      if (profile) {
        this.username = profile.username;
        logger.info('Successfully verified Twitter profile', { username: this.username });
      } else {
        logger.warn('Could not verify Twitter profile after authentication');
      }

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
    }
    if (this.mentionCheckInterval) {
      clearInterval(this.mentionCheckInterval);
      this.mentionCheckInterval = undefined;
    }
    logger.info('Stopped listening for mentions');
  }

  async startMentionListener(): Promise<void> {
    logger.debug('Starting mention listener');
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

  private async checkMentions(): Promise<void> {
    logger.debug('Checking mentions');
    if (!this.username || !this.isAuthenticated) {
      logger.debug('Skipping mention check - not authenticated or no username');
      return;
    }

    let retries = 0;
    const maxRetries = this.config.maxRetries;

    while (retries < maxRetries) {
      try {
        await this.handleRateLimit();
        
        const profile = await this.scraper.me();
        if (!profile) {
          throw new Error('Failed to fetch profile');
        }

        // Increase tweet fetch count and add timestamp logging
        logger.info('Starting mention check', {
          username: this.username,
          timestamp: new Date().toISOString(),
          lastProcessedTweet: Array.from(this.processedMentions)[0]
        });

        // Search for tweets mentioning the account - include both mentions and tweets to the account
        const tweetsGenerator = this.scraper.searchTweets(`to:${this.username} OR @${this.username}`, 100, SearchMode.Latest);
        const tweets = [];
        let tweetCount = 0;
        
        for await (const tweet of tweetsGenerator) {
          tweetCount++;
          logger.debug('Processing tweet', { 
            id: tweet.id,
            text: tweet.text,
            username: tweet.username || tweet.name,
            timestamp: new Date().toISOString()
          });
          
          if (this.isValidTweet(tweet)) {
            tweets.push(tweet);
          }
        }

        logger.info('Mention check summary', {
          totalTweetsChecked: tweetCount,
          validTweetsFound: tweets.length,
          timestamp: new Date().toISOString()
        });

        for (const tweet of tweets) {
          await this.processMention(tweet, profile).catch(error => {
            logger.error('Error processing mention:', error);
          });
        }

        break;
      } catch (error) {
        retries++;
        logger.error(`Mention check failed (attempt ${retries}/${maxRetries}):`, error);
        
        if (this.isSessionError(error)) {
          await this.handleSessionError();
          break;
        }
        
        if (retries < maxRetries) {
          await new Promise(resolve => 
            setTimeout(resolve, this.config.backoffTime * retries)
          );
        } else {
          logger.error('Max retries reached for mention check');
        }
      }
    }
  }

  private isValidTweet(tweet: Tweet): tweet is Tweet {
    logger.info('Starting tweet validation', {
        tweet_id: tweet?.id,
        tweet_text: tweet?.text,
        tweet_username: tweet?.username || tweet?.name
    });

    const hasRequiredFields = Boolean(
        tweet &&
        tweet.id &&
        tweet.text &&
        (tweet.username || tweet.name)
    );

    if (!hasRequiredFields || !tweet.text) {
        logger.debug('Tweet missing required fields', { 
            has_tweet: Boolean(tweet),
            has_id: Boolean(tweet?.id),
            has_text: Boolean(tweet?.text),
            has_username: Boolean(tweet?.username || tweet?.name)
        });
        return false;
    }

    const tweetText = tweet.text.toLowerCase();
    const hasMentionFormat = tweetText.includes(`@${this.username?.toLowerCase()}`) && 
                            (tweetText.includes('analyze') || tweetText.includes('check'));
    const githubUrl = this.extractGitHubUrl(tweet.text);
    const hasGitHubUrl = Boolean(githubUrl);

    logger.info('Tweet validation details', {
        id: tweet.id,
        text: tweet.text,
        hasMentionFormat,
        mentionFound: tweetText.includes(`@${this.username?.toLowerCase()}`),
        hasAnalyzeOrCheck: tweetText.includes('analyze') || tweetText.includes('check'),
        hasGitHubUrl,
        githubUrl,
        timestamp: new Date().toISOString()
    });

    return hasRequiredFields && hasMentionFormat && hasGitHubUrl;
  }

  private async processMention(tweet: Tweet, profile: Profile): Promise<void> {
    if (!tweet.id || !tweet.text || this.processedMentions.has(tweet.id)) {
      return;
    }

    let retries = 0;
    while (retries < this.config.maxRetries) {
      try {
        const githubUrl = this.extractGitHubUrl(tweet.text);
        if (!githubUrl) {
          logger.debug('No valid GitHub URL found in mention', { text: tweet.text });
          return;
        }

        const mention: IMention = {
          id: tweet.id,
          text: tweet.text,
          author: tweet.username || tweet.name || 'unknown',
          repositoryUrl: githubUrl
        };

        for (const callback of this.mentionCallbacks) {
          await callback(mention);
        }

        this.processedMentions.add(tweet.id);
        setTimeout(() => {
          if (tweet.id) {
            this.processedMentions.delete(tweet.id);
          }
        }, this.config.cacheTimeout);

        break;
      } catch (error) {
        retries++;
        if (retries === this.config.maxRetries) {
          throw error;
        }
        await new Promise(resolve => 
          setTimeout(resolve, this.config.backoffTime * retries)
        );
      }
    }
  }

  private extractGitHubUrl(text: string): string | undefined {
    // Updated regex to handle more GitHub URL formats including www
    const githubUrlRegex = /https?:\/\/(?:www\.)?github\.com\/[\w-]+\/[\w-]+(?:\/)?/i;
    const match = text.match(githubUrlRegex);
    if (match) {
      // Clean up the URL by removing trailing slashes and normalizing to non-www version
      return match[0].replace(/\/$/, '').replace('www.github.com', 'github.com');
    }
    return undefined;
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
} 