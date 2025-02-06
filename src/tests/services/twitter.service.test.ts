import { TwitterService } from '../../services/twitter.service';
import { MockScraper } from '../mocks/twitter-scraper.mock';
import { SessionService } from '../../services/session.service';
import { IMention } from '../../types/interfaces';

// Mock the Scraper import
jest.mock('agent-twitter-client', () => ({
  Scraper: jest.fn().mockImplementation(() => new MockScraper()),
}));

describe('TwitterService', () => {
  let twitterService: TwitterService;
  let sessionService: SessionService;
  let mentionCallback: jest.Mock;

  beforeEach(() => {
    sessionService = new SessionService();
    twitterService = new TwitterService(sessionService);
    mentionCallback = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication', () => {
    it('should authenticate successfully with valid credentials', async () => {
      await twitterService.authenticate({ username: 'test', password: 'test' });
      expect(twitterService['isAuthenticated']).toBe(true);
    });

    it('should throw error with invalid credentials', async () => {
      await expect(
        twitterService.authenticate({ username: '', password: '' })
      ).rejects.toThrow('Invalid credentials');
    });

    it('should restore session from cookies', async () => {
      await sessionService.saveCookies([{ name: 'test', value: 'test' }]);
      await twitterService.initialize();
      expect(twitterService['isAuthenticated']).toBe(true);
    });
  });

  describe('Mention Handling', () => {
    beforeEach(async () => {
      await twitterService.authenticate({ username: 'test', password: 'test' });
    });

    it('should start mention listener after authentication', async () => {
      expect(twitterService['mentionCheckInterval']).toBeDefined();
    });

    it('should detect and process mentions', async () => {
      twitterService.onMention(mentionCallback);
      
      // Wait for the first mention check interval
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(mentionCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '1',
          text: expect.stringContaining('github.com'),
          author: 'testuser',
        })
      );
    });

    it('should extract GitHub URL from mention', async () => {
      const mockMention: IMention = {
        id: '1',
        text: '@jeffersonighalo analyze https://github.com/openai/whisper',
        author: 'testuser',
        repositoryUrl: 'https://github.com/openai/whisper'
      };

      twitterService.onMention(mentionCallback);
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(mentionCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryUrl: mockMention.repositoryUrl
        })
      );
    });

    it('should not process the same mention twice', async () => {
      twitterService.onMention(mentionCallback);
      
      // Wait for two mention check intervals
      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(mentionCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tweet Functionality', () => {
    beforeEach(async () => {
      await twitterService.authenticate({ username: 'test', password: 'test' });
    });

    it('should successfully send a tweet', async () => {
      const tweetId = await twitterService.tweet('Test tweet');
      expect(tweetId).toBeDefined();
    });

    it('should successfully reply to a mention', async () => {
      const mention: IMention = {
        id: '1',
        text: 'Test mention',
        author: 'testuser'
      };

      await expect(
        twitterService.reply(mention, 'Test reply')
      ).resolves.not.toThrow();
    });
  });
}); 