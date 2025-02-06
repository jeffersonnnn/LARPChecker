import { IAnalysisResult, IRepositoryMetadata, ICacheService } from '../../types/interfaces';
import logger from '../logger';

interface CacheEntry<T> {
  data: T;
  timestamp: Date;
  ttl: number;
}

interface CacheConfig {
  ttl?: number;
  checkPeriod?: number;
}

export class CacheService implements ICacheService {
  private cache: Map<string, CacheEntry<any>>;
  private static readonly DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly DEFAULT_CHECK_PERIOD = 60 * 60; // 1 hour
  private checkInterval: NodeJS.Timeout | null = null;
  private config: CacheConfig;

  constructor(config?: CacheConfig) {
    this.cache = new Map();
    this.config = {
      ttl: config?.ttl ?? CacheService.DEFAULT_TTL,
      checkPeriod: config?.checkPeriod ?? CacheService.DEFAULT_CHECK_PERIOD
    };
  }

  async initialize(): Promise<void> {
    // Start periodic cleanup
    if (this.config.checkPeriod) {
      this.checkInterval = setInterval(() => {
        this.cleanup();
      }, this.config.checkPeriod * 1000);
    }
    logger.debug('Cache service initialized');
  }

  private cleanup(): void {
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        logger.debug(`Cleaned up expired cache entry for key: ${key}`);
      }
    }
  }

  async set<T>(key: string, value: T, ttl: number = CacheService.DEFAULT_TTL): Promise<void> {
    this.cache.set(key, {
      data: value,
      timestamp: new Date(),
      ttl
    });
    logger.debug(`Cache entry set for key: ${key}`);
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      logger.debug(`Cache entry expired for key: ${key}`);
      return null;
    }

    return entry.data;
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    logger.debug(`Cache entry deleted for key: ${key}`);
  }

  async clear(): Promise<void> {
    this.cache.clear();
    logger.debug('Cache cleared');
  }

  async invalidateAll(repositoryUrl: string): Promise<void> {
    const prefix = `repo:${repositoryUrl}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
    logger.debug(`Cache entries invalidated for repository: ${repositoryUrl}`);
  }

  async invalidateProgress(repositoryUrl: string): Promise<void> {
    const progressKey = `repo:${repositoryUrl}:progress`;
    this.cache.delete(progressKey);
    logger.debug(`Progress cache invalidated for repository: ${repositoryUrl}`);
  }

  private isExpired(entry: CacheEntry<any>): boolean {
    const now = new Date().getTime();
    const expiryTime = entry.timestamp.getTime() + entry.ttl;
    return now > expiryTime;
  }

  // Helper methods for specific data types
  async setAnalysisResult(repositoryUrl: string, result: IAnalysisResult): Promise<void> {
    await this.set(`repo:${repositoryUrl}:analysis`, result);
  }

  async getAnalysisResult(repositoryUrl: string): Promise<IAnalysisResult | null> {
    return this.get(`repo:${repositoryUrl}:analysis`);
  }

  async setRepositoryMetadata(repositoryUrl: string, metadata: IRepositoryMetadata): Promise<void> {
    await this.set(`repo:${repositoryUrl}:metadata`, metadata);
  }

  async getRepositoryMetadata(repositoryUrl: string): Promise<IRepositoryMetadata | null> {
    return this.get(`repo:${repositoryUrl}:metadata`);
  }

  async cacheProgress(repositoryUrl: string, progress: number): Promise<void> {
    const key = `progress:${repositoryUrl}`;
    await this.set(key, progress, 3600); // Cache for 1 hour
  }
} 