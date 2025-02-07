import { Tweet, Profile } from 'agent-twitter-client';

export class MockScraper {
  private isLoggedIn = false;
  private mockProfile = {
    username: 'jeffersonighalo',
    name: 'Jefferson Ighalo',
    description: 'Test profile description',
    verified: true,
    protected: false,
    joinDate: '2020-01-01',
    location: 'Test Location',
    url: 'https://twitter.com/jeffersonighalo',
    avatar: 'https://example.com/avatar.jpg'
  };

  private mockTweets = [
    {
      id: '123456789',
      text: '@jeffersonighalo Please analyze https://github.com/openai/whisper',
      username: 'testuser',
      name: 'Test User',
      timestamp: Date.now(),
      mentions: ['jeffersonighalo'],
      hashtags: [],
      urls: ['https://github.com/openai/whisper'],
      videos: [],
      photos: [],
      thread: [],
      likes: 10,
      retweets: 5,
      replies: 2,
      views: 100
    },
    {
      id: '987654321',
      text: 'Just a regular tweet without mentions',
      username: 'otheruser',
      name: 'Other User',
      timestamp: Date.now(),
      mentions: [],
      hashtags: [],
      urls: [],
      videos: [],
      photos: [],
      thread: [],
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0
    }
  ];

  async login(username: string, password: string): Promise<void> {
    if (username && password) {
      this.isLoggedIn = true;
      return;
    }
    throw new Error('Invalid credentials');
  }

  async me(): Promise<Profile> {
    if (!this.isLoggedIn) {
      throw new Error('Not authenticated');
    }
    return this.mockProfile;
  }

  async *getTweetsAndReplies(username: string, count: number): AsyncGenerator<Tweet> {
    if (!this.isLoggedIn) {
      throw new Error('Not authenticated');
    }
    
    for (const tweet of this.mockTweets.slice(0, count)) {
      yield tweet;
    }
  }

  async sendTweetV2(content: string, replyToId?: string): Promise<{ id: string }> {
    if (!this.isLoggedIn) {
      throw new Error('Not authenticated');
    }
    return { id: Date.now().toString() };
  }

  async getCookies(): Promise<any[]> {
    return [{ name: 'test_cookie', value: 'test_value' }];
  }

  async setCookies(cookies: any[]): Promise<void> {
    if (cookies.length > 0) {
      this.isLoggedIn = true;
    }
  }
} 
