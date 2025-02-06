import {
  IStorageService,
  IQueueService,
  IRepositoryService,
  RateLimitType,
  IRateLimit,
  ResourceMetrics,
  ResourceError,
  ResourceErrorCode,
  IQueueItem,
  IRepoMetadata,
  ICacheService
} from '../../types/interfaces';
import logger from '../logger';
import os from 'os';

export class ResourceManager {
  private static readonly STORAGE_CLEANUP_THRESHOLD = 0.9; // 90%
  private static readonly QUEUE_CLEANUP_AGE = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly RATE_LIMIT_BUFFER = 0.1; // 10% buffer
  private static readonly SYSTEM_HEALTH_THRESHOLD = 0.9; // 90%

  constructor(
    private storageService: IStorageService,
    private queueService: IQueueService,
    private repositoryService: IRepositoryService,
    private cacheService: ICacheService
  ) {
    // Start periodic resource checks
    this.startPeriodicChecks();
  }

  private startPeriodicChecks(): void {
    // Check resources every 5 minutes
    setInterval(() => this.checkResources(), 5 * 60 * 1000);
  }

  async checkResources(): Promise<ResourceMetrics> {
    try {
      const [storageMetrics, queueMetrics, rateLimits] = await Promise.all([
        this.storageService.getMetrics(),
        this.queueService.getMetrics(),
        this.getAllRateLimits()
      ]);

      // Get system metrics
      const cpuUsage = os.loadavg()[0] / os.cpus().length; // Normalized CPU usage
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memoryUsage = (totalMem - freeMem) / totalMem;

      const metrics: ResourceMetrics = {
        storageUsage: {
          used: storageMetrics.totalSize,
          total: this.storageService.getTotalQuota(),
          percentage: storageMetrics.totalSize / this.storageService.getTotalQuota()
        },
        queueMetrics: {
          length: queueMetrics.totalItems,
          active: queueMetrics.processingItems,
          maxConcurrent: queueMetrics.maxConcurrent,
          averageWaitTime: queueMetrics.averageWaitTime
        },
        activeAnalyses: queueMetrics.processingItems,
        rateLimits,
        systemHealth: {
          cpuUsage,
          memoryUsage,
          isHealthy: cpuUsage < ResourceManager.SYSTEM_HEALTH_THRESHOLD && 
                    memoryUsage < ResourceManager.SYSTEM_HEALTH_THRESHOLD
        },
        available: false
      };

      // Check if resources are available based on multiple conditions
      const isStorageAvailable = metrics.storageUsage.percentage < ResourceManager.STORAGE_CLEANUP_THRESHOLD;
      const isQueueAvailable = metrics.queueMetrics.active < metrics.queueMetrics.maxConcurrent;
      const areRateLimitsAvailable = Array.from(rateLimits.values()).every(limit => !this.isRateLimitCritical(limit));
      const isSystemHealthy = metrics.systemHealth.isHealthy;

      // Set overall availability
      metrics.available = isStorageAvailable && isQueueAvailable && areRateLimitsAvailable && isSystemHealthy;

      // Trigger cleanups if needed
      if (!isStorageAvailable) {
        await this.performStorageCleanup();
      }

      if (metrics.queueMetrics.averageWaitTime > ResourceManager.QUEUE_CLEANUP_AGE) {
        await this.performQueueCleanup();
      }

      return metrics;
    } catch (error) {
      logger.error('Resource check failed:', error);
      throw new ResourceError(
        'Failed to check resources',
        ResourceErrorCode.SYSTEM_ERROR,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private async performStorageCleanup(): Promise<void> {
    try {
      logger.info('Starting storage cleanup');
      
      // Get repositories sorted by last access time
      const repos = await this.storageService.getRepoMetadata();
      const oldRepos = repos.filter((repo: IRepoMetadata) => {
        const age = Date.now() - repo.lastAccessed.getTime();
        return age > ResourceManager.QUEUE_CLEANUP_AGE;
      });

      // Clean up old repositories
      for (const repo of oldRepos) {
        try {
          await this.storageService.cleanupRepository(repo.url);
          await this.cacheService.invalidateAll(repo.url);
        } catch (error) {
          logger.error('Failed to cleanup repository:', error);
          // Continue with other repos even if one fails
        }
      }

      logger.info('Storage cleanup completed', { cleanedRepos: oldRepos.length });
    } catch (error) {
      logger.error('Storage cleanup failed:', error);
      throw new ResourceError(
        'Storage cleanup failed',
        ResourceErrorCode.CLEANUP_FAILED,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private async performQueueCleanup(): Promise<void> {
    try {
      logger.info('Starting queue cleanup');

      // Get all failed or stuck items
      const items = await this.queueService.getItemsByStatus('FAILED');
      
      // Clean up old queue items
      for (const item of items) {
        const age = Date.now() - item.createdAt.getTime();
        if (age > ResourceManager.QUEUE_CLEANUP_AGE) {
          await this.queueService.cancel(item.id);
          await this.cacheService.invalidateProgress(item.repositoryUrl);
        }
      }

      logger.info('Queue cleanup completed');
    } catch (error) {
      logger.error('Queue cleanup failed:', error);
      throw new ResourceError(
        'Queue cleanup failed',
        ResourceErrorCode.CLEANUP_FAILED,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private async getAllRateLimits(): Promise<Map<RateLimitType, IRateLimit>> {
    const limits = new Map<RateLimitType, IRateLimit>();
    
    for (const type of Object.values(RateLimitType)) {
      try {
        const limit = await this.repositoryService.getRateLimit(type);
        if (limit) {
          limits.set(type, limit);

          // Check if we're close to the limit
          if (this.isRateLimitCritical(limit)) {
            logger.warn('Rate limit critical', { type, limit });
          }
        }
      } catch (error) {
        logger.error('Failed to get rate limit:', error);
        throw new ResourceError(
          'Failed to get rate limit',
          ResourceErrorCode.RATE_LIMIT_EXCEEDED,
          { type, error: error instanceof Error ? error.message : String(error) }
        );
      }
    }

    return limits;
  }

  private isRateLimitCritical(limit: IRateLimit): boolean {
    const buffer = Math.ceil(limit.limit * ResourceManager.RATE_LIMIT_BUFFER);
    return limit.remaining <= buffer;
  }

  async validateResources(repositoryUrl: string): Promise<boolean> {
    try {
      const metrics = await this.checkResources();
      
      if (!metrics.available) {
        const reasons = [];
        
        if (metrics.storageUsage.percentage >= ResourceManager.STORAGE_CLEANUP_THRESHOLD) {
          reasons.push('Storage quota exceeded');
        }
        
        if (metrics.queueMetrics.active >= metrics.queueMetrics.maxConcurrent) {
          reasons.push('Queue capacity reached');
        }
        
        if (!metrics.systemHealth.isHealthy) {
          reasons.push('System resources constrained');
        }

        throw new ResourceError(
          'Resources not available',
          ResourceErrorCode.RESOURCE_INVALID,
          { reasons, repositoryUrl }
        );
      }

      return true;
    } catch (error) {
      if (error instanceof ResourceError) {
        throw error;
      }
      
      logger.error('Resource validation failed:', error);
      throw new ResourceError(
        'Resource validation failed',
        ResourceErrorCode.SYSTEM_ERROR,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  async cleanup(): Promise<void> {
    try {
      await Promise.all([
        this.performStorageCleanup(),
        this.performQueueCleanup()
      ]);
    } catch (error) {
      logger.error('Cleanup failed:', error);
      throw new ResourceError(
        'Cleanup failed',
        ResourceErrorCode.CLEANUP_FAILED,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }
} 