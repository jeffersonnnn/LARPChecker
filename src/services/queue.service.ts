import { PrismaClient } from '@prisma/client';
import { 
  IQueueService, 
  IQueueItem, 
  QueueStatus,
  AnalysisStatus,
  IQueueConfig,
  IQueueMetrics 
} from '../types/interfaces';
import logger from './logger';

const DEFAULT_CONFIG: IQueueConfig = {
  maxRetries: 3,
  retryDelay: 5000,          // 5 seconds
  maxConcurrent: 5,
  priorityLevels: 5,
  defaultPriority: 2,
  processingTimeout: 300000, // 5 minutes
};

export class QueueService implements IQueueService {
  private prisma: PrismaClient;
  private config: IQueueConfig;
  private processingItems: Set<string>;

  constructor(prisma: PrismaClient, config: Partial<IQueueConfig> = {}) {
    this.prisma = prisma;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.processingItems = new Set();
  }

  async enqueue(repositoryUrl: string, userId: string): Promise<void> {
    try {
      await this.prisma.analysisQueue.create({
        data: {
          repositoryUrl,
          status: QueueStatus.PENDING,
          priority: this.config.defaultPriority,
          userId,
        },
      });

      logger.info('Added repository to analysis queue', { repositoryUrl, userId });
    } catch (error) {
      logger.error('Failed to enqueue analysis request', { error, repositoryUrl, userId });
      throw new Error('Failed to enqueue analysis request');
    }
  }

  async dequeue(): Promise<string | null> {
    try {
      if (this.processingItems.size >= this.config.maxConcurrent) {
        return null;
      }

      // Get the highest priority pending item
      const queueItem = await this.prisma.analysisQueue.findFirst({
        where: {
          status: QueueStatus.PENDING,
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'asc' },
        ],
      });

      if (!queueItem) {
        return null;
      }

      // Update the status to processing
      await this.prisma.analysisQueue.update({
        where: { id: queueItem.id },
        data: {
          status: QueueStatus.PROCESSING,
          startedAt: new Date(),
        },
      });

      this.processingItems.add(queueItem.repositoryUrl);
      return queueItem.repositoryUrl;
    } catch (error) {
      logger.error('Failed to dequeue analysis request', { error });
      throw new Error('Failed to dequeue analysis request');
    }
  }

  async updateStatus(repositoryUrl: string, status: AnalysisStatus): Promise<void> {
    try {
      const queueStatus = this.mapAnalysisStatusToQueueStatus(status);
      await this.prisma.analysisQueue.updateMany({
        where: { repositoryUrl },
        data: {
          status: queueStatus,
          completedAt: [QueueStatus.COMPLETED, QueueStatus.FAILED, QueueStatus.CANCELLED].includes(queueStatus) 
            ? new Date() 
            : undefined,
        },
      });

      if ([QueueStatus.COMPLETED, QueueStatus.FAILED, QueueStatus.CANCELLED].includes(queueStatus)) {
        this.processingItems.delete(repositoryUrl);
      }

      logger.info('Updated queue item status', { repositoryUrl, status });
    } catch (error) {
      logger.error('Failed to update queue item status', { error, repositoryUrl, status });
      throw new Error('Failed to update queue item status');
    }
  }

  async getPosition(repositoryUrl: string): Promise<number> {
    try {
      const item = await this.prisma.analysisQueue.findFirst({
        where: { 
          repositoryUrl,
          status: QueueStatus.PENDING
        },
      });

      if (!item) {
        return -1;
      }

      const position = await this.prisma.analysisQueue.count({
        where: {
          status: QueueStatus.PENDING,
          OR: [
            { priority: { gt: item.priority } },
            {
              AND: [
                { priority: item.priority },
                { createdAt: { lt: item.createdAt } },
              ],
            },
          ],
        },
      });

      return position + 1;
    } catch (error) {
      logger.error('Failed to get queue position', { error, repositoryUrl });
      throw new Error('Failed to get queue position');
    }
  }

  async getQueueLength(): Promise<number> {
    try {
      return await this.prisma.analysisQueue.count({
        where: {
          status: QueueStatus.PENDING,
        },
      });
    } catch (error) {
      logger.error('Failed to get queue length', { error });
      throw new Error('Failed to get queue length');
    }
  }

  async isQueued(repositoryUrl: string): Promise<boolean> {
    try {
      const count = await this.prisma.analysisQueue.count({
        where: {
          repositoryUrl,
          status: {
            in: [QueueStatus.PENDING, QueueStatus.PROCESSING]
          }
        },
      });
      return count > 0;
    } catch (error) {
      logger.error('Failed to check if repository is queued', { error, repositoryUrl });
      throw new Error('Failed to check if repository is queued');
    }
  }

  async removeFromQueue(repositoryUrl: string): Promise<void> {
    try {
      await this.prisma.analysisQueue.deleteMany({
        where: { repositoryUrl },
      });
      this.processingItems.delete(repositoryUrl);
      logger.info('Removed repository from queue', { repositoryUrl });
    } catch (error) {
      logger.error('Failed to remove repository from queue', { error, repositoryUrl });
      throw new Error('Failed to remove repository from queue');
    }
  }

  async clearQueue(): Promise<void> {
    try {
      await this.prisma.analysisQueue.deleteMany({});
      this.processingItems.clear();
      logger.info('Queue cleared');
    } catch (error) {
      logger.error('Failed to clear queue', { error });
      throw new Error('Failed to clear queue');
    }
  }

  async getMetrics(): Promise<IQueueMetrics> {
    try {
      const [totalItems, processingItems, failedItems] = await Promise.all([
        this.prisma.analysisQueue.count(),
        this.prisma.analysisQueue.count({
          where: { status: QueueStatus.PROCESSING }
        }),
        this.prisma.analysisQueue.count({
          where: { status: QueueStatus.FAILED }
        })
      ]);

      const queueItems = await this.prisma.analysisQueue.findMany({
        where: {
          status: {
            in: [QueueStatus.COMPLETED, QueueStatus.FAILED]
          }
        },
        select: {
          createdAt: true,
          startedAt: true,
          completedAt: true
        }
      });

      let totalWaitTime = 0;
      let totalProcessingTime = 0;
      let itemsWithTimes = 0;

      for (const item of queueItems) {
        if (item.startedAt && item.createdAt) {
          totalWaitTime += item.startedAt.getTime() - item.createdAt.getTime();
        }
        if (item.completedAt && item.startedAt) {
          totalProcessingTime += item.completedAt.getTime() - item.startedAt.getTime();
          itemsWithTimes++;
        }
      }

      return {
        totalItems,
        processingItems,
        failedItems,
        averageWaitTime: itemsWithTimes > 0 ? totalWaitTime / itemsWithTimes : 0,
        averageProcessingTime: itemsWithTimes > 0 ? totalProcessingTime / itemsWithTimes : 0,
        maxConcurrent: this.config.maxConcurrent
      };
    } catch (error) {
      logger.error('Failed to get queue metrics', { error });
      throw new Error('Failed to get queue metrics');
    }
  }

  async getItemsByStatus(status: string): Promise<IQueueItem[]> {
    try {
      const items = await this.prisma.analysisQueue.findMany({
        where: { status: status as QueueStatus },
        orderBy: { createdAt: 'asc' }
      });

      return items.map(item => ({
        id: item.id,
        repositoryUrl: item.repositoryUrl,
        status: item.status as QueueStatus,
        priority: item.priority,
        userId: item.userId || '',
        createdAt: item.createdAt,
        startedAt: item.startedAt || undefined,
        completedAt: item.completedAt || undefined,
        error: item.error || undefined
      }));
    } catch (error) {
      logger.error('Failed to get items by status', { error, status });
      throw new Error('Failed to get items by status');
    }
  }

  async cancel(id: string): Promise<void> {
    try {
      const item = await this.prisma.analysisQueue.findUnique({
        where: { id }
      });

      if (!item) {
        throw new Error('Queue item not found');
      }

      await this.prisma.analysisQueue.update({
        where: { id },
        data: {
          status: QueueStatus.CANCELLED,
          completedAt: new Date()
        }
      });

      if (item.repositoryUrl) {
        this.processingItems.delete(item.repositoryUrl);
      }

      logger.info('Cancelled queue item', { id });
    } catch (error) {
      logger.error('Failed to cancel queue item', { error, id });
      throw new Error('Failed to cancel queue item');
    }
  }

  private mapAnalysisStatusToQueueStatus(status: AnalysisStatus): QueueStatus {
    switch (status) {
      case AnalysisStatus.QUEUED:
        return QueueStatus.PENDING;
      case AnalysisStatus.IN_PROGRESS:
        return QueueStatus.PROCESSING;
      case AnalysisStatus.COMPLETED:
        return QueueStatus.COMPLETED;
      case AnalysisStatus.FAILED:
        return QueueStatus.FAILED;
      case AnalysisStatus.CANCELLED:
        return QueueStatus.CANCELLED;
      default:
        throw new Error(`Unknown analysis status: ${status}`);
    }
  }
} 