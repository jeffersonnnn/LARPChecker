import { PrismaClient, Commit, Dependency, Language, RateLimit, DependencyType as PrismaDependencyType, RateLimitType as PrismaRateLimitType } from '@prisma/client';
import { 
  IRepositoryService, 
  IRepositoryMetadata, 
  RateLimitType, 
  IRateLimit,
  ICommit,
  IDependency,
  ILanguage,
  DependencyType
} from '../types/interfaces';
import logger from './logger';

const LARGE_REPO_SIZE = 100000; // 100MB in KB
const RATE_LIMIT_THRESHOLD = 100; // Number of remaining requests before switching to clone

export class RepositoryService implements IRepositoryService {
  private prisma: PrismaClient;
  private rateLimits: Map<RateLimitType, IRateLimit>;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.rateLimits = new Map();
  }

  async getRepositoryInfo(repositoryUrl: string): Promise<IRepositoryMetadata> {
    try {
      const metadata = await this.getMetadata(repositoryUrl);
      return metadata;
    } catch (error) {
      logger.error('Failed to get repository info', { error, repositoryUrl });
      throw new Error('Failed to get repository info');
    }
  }

  async validateRepository(repositoryUrl: string): Promise<boolean> {
    try {
      await this.getMetadata(repositoryUrl);
      return true;
    } catch {
      return false;
    }
  }

  async getCommitHistory(repositoryUrl: string): Promise<ICommit[]> {
    try {
      const commits = await this.prisma.commit.findMany({
        where: { repositoryUrl },
        orderBy: { timestamp: 'desc' }
      });

      return commits.map((commit: Commit): ICommit => ({
        id: commit.id,
        sha: commit.sha,
        message: commit.message,
        author: commit.author,
        timestamp: commit.timestamp,
        additions: commit.additions,
        deletions: commit.deletions,
        files: commit.files,
        repositoryUrl: commit.repositoryUrl,
        createdAt: commit.createdAt,
        updatedAt: commit.updatedAt
      }));
    } catch (error) {
      logger.error('Failed to get commit history', { error, repositoryUrl });
      throw new Error('Failed to get commit history');
    }
  }

  async getDependencies(repositoryUrl: string): Promise<IDependency[]> {
    try {
      const dependencies = await this.prisma.dependency.findMany({
        where: { repositoryUrl }
      });

      return dependencies.map((dep: Dependency): IDependency => ({
        id: dep.id,
        name: dep.name,
        version: dep.version,
        type: dep.type as DependencyType,
        source: dep.source,
        repositoryUrl: dep.repositoryUrl,
        createdAt: dep.createdAt,
        updatedAt: dep.updatedAt
      }));
    } catch (error) {
      logger.error('Failed to get dependencies', { error, repositoryUrl });
      throw new Error('Failed to get dependencies');
    }
  }

  async getLanguages(repositoryUrl: string): Promise<{ [key: string]: number }> {
    try {
      type LanguageResult = {
        name: string;
        bytes: number;
      };

      const languages = await this.prisma.language.findMany({
        where: { repositoryUrl },
        select: {
          name: true,
          bytes: true
        }
      }) as LanguageResult[];

      const languageMap: { [key: string]: number } = {};
      for (const lang of languages) {
        languageMap[lang.name] = lang.bytes;
      }
      return languageMap;
    } catch (error) {
      logger.error('Failed to get languages', { error, repositoryUrl });
      throw new Error('Failed to get languages');
    }
  }

  async getMetadata(repositoryUrl: string): Promise<IRepositoryMetadata> {
    try {
      const metadata = await this.prisma.repositoryMetadata.findUnique({
        where: { url: repositoryUrl },
        select: {
          name: true,
          owner: true,
          description: true,
          stars: true,
          forks: true,
          issues: true,
          lastCommit: true,
          contributors: true,
          languages: true,
          topics: true,
          size: true
        }
      });

      if (!metadata) {
        throw new Error('Repository not found');
      }

      return {
        owner: metadata.owner,
        name: metadata.name,
        description: metadata.description || '',
        stars: metadata.stars,
        forks: metadata.forks,
        issues: metadata.issues,
        lastCommit: metadata.lastCommit,
        contributors: metadata.contributors,
        languages: metadata.languages as unknown as { [key: string]: number },
        topics: metadata.topics as string[],
        url: repositoryUrl,
        size: metadata.size || 0
      };
    } catch (error) {
      logger.error('Failed to get repository metadata', { error, repositoryUrl });
      throw new Error('Failed to get repository metadata');
    }
  }

  async updateMetadata(url: string, metadata: Partial<IRepositoryMetadata>): Promise<void> {
    try {
      await this.prisma.repositoryMetadata.upsert({
        where: { url },
        create: {
          url,
          owner: metadata.owner!,
          name: metadata.name!,
          description: metadata.description || '',
          stars: metadata.stars || 0,
          forks: metadata.forks || 0,
          issues: metadata.issues || 0,
          lastCommit: metadata.lastCommit,
          contributors: metadata.contributors || 0,
          languages: metadata.languages || {},
          topics: metadata.topics || [],
          size: metadata.size || 0
        },
        update: metadata,
      });

      logger.info('Updated repository metadata', { url });
    } catch (error) {
      logger.error('Failed to update repository metadata', { error, url });
      throw new Error('Failed to update repository metadata');
    }
  }

  async shouldUseClone(url: string): Promise<boolean> {
    try {
      // Check repository size
      const metadata = await this.getMetadata(url);
      if (metadata.size > LARGE_REPO_SIZE) {
        logger.info('Repository size exceeds threshold, using clone', { url, size: metadata.size });
        return true;
      }

      // Check rate limits
      const rateLimit = await this.getRateLimit(RateLimitType.GITHUB_API);
      if (rateLimit.remaining < RATE_LIMIT_THRESHOLD) {
        const timeToReset = Math.ceil((rateLimit.reset.getTime() - Date.now()) / 1000 / 60);
        logger.info('Rate limit low, using clone', { 
          url, 
          remaining: rateLimit.remaining,
          minutesToReset: timeToReset 
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error determining clone strategy', { error, url });
      // Default to using clone in case of errors
      return true;
    }
  }

  async getRateLimit(type: RateLimitType): Promise<IRateLimit> {
    try {
      // First check in-memory cache
      const cachedLimit = this.rateLimits.get(type);
      if (cachedLimit && cachedLimit.reset > new Date()) {
        return cachedLimit;
      }

      // If not in cache or expired, get from database
      const rateLimit = await this.prisma.rateLimit.findUnique({
        where: { 
          type: type as PrismaRateLimitType 
        }
      });

      if (!rateLimit) {
        // Return default values if no rate limit info exists
        const defaultLimit: IRateLimit = {
          type,
          remaining: RATE_LIMIT_THRESHOLD + 1,
          reset: new Date(Date.now() + 3600000),
          limit: 5000
        };
        await this.updateRateLimit(type, defaultLimit);
        return defaultLimit;
      }

      const limit: IRateLimit = {
        id: rateLimit.id,
        type: rateLimit.type as RateLimitType,
        remaining: rateLimit.remaining,
        reset: rateLimit.reset,
        limit: rateLimit.limit,
        createdAt: rateLimit.createdAt,
        updatedAt: rateLimit.updatedAt
      };

      // Update cache
      this.rateLimits.set(type, limit);
      return limit;
    } catch (error) {
      logger.error('Failed to get rate limit', { error, type });
      throw new Error('Failed to get rate limit');
    }
  }

  async updateRateLimit(type: RateLimitType, limit: IRateLimit): Promise<void> {
    try {
      // Update database using upsert
      await this.prisma.rateLimit.upsert({
        where: {
          type: type as PrismaRateLimitType
        },
        create: {
          type: type as PrismaRateLimitType,
          remaining: limit.remaining,
          limit: limit.limit,
          reset: limit.reset
        },
        update: {
          remaining: limit.remaining,
          limit: limit.limit,
          reset: limit.reset
        }
      });

      // Update cache
      this.rateLimits.set(type, limit);
      logger.info('Updated rate limit', { type, remaining: limit.remaining, reset: limit.reset });
    } catch (error) {
      logger.error('Failed to update rate limit', { error, type });
      throw new Error('Failed to update rate limit');
    }
  }
} 