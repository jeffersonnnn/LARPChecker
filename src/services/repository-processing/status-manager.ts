import {
  IAnalysisProgress,
  AnalysisStatus,
  IQueueService,
  IAnalysisResult
} from '../../types/interfaces';
import { NotificationService } from './notification-service';
import { CacheService } from './cache-service';
import logger from '../logger';

interface ErrorRecoveryStrategy {
  maxRetries: number;
  backoffTime: number;
  shouldRetry: (error: Error) => boolean;
  onRetry: (attempt: number) => Promise<void>;
}

export class StatusManager {
  private progressMap: Map<string, IAnalysisProgress>;
  private retryStrategies: Map<string, ErrorRecoveryStrategy>;
  private retryAttempts: Map<string, number>;

  constructor(
    private queueService: IQueueService,
    private notificationService: NotificationService,
    private cacheService: CacheService
  ) {
    this.progressMap = new Map();
    this.retryStrategies = new Map();
    this.retryAttempts = new Map();
    this.initializeRetryStrategies();
  }

  private initializeRetryStrategies(): void {
    // Rate limit error strategy
    this.retryStrategies.set('RATE_LIMIT', {
      maxRetries: 3,
      backoffTime: 60000, // 1 minute
      shouldRetry: (error: Error) => error.message.includes('rate limit'),
      onRetry: async (attempt: number) => {
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, this.calculateBackoff(attempt)));
      }
    });

    // Network error strategy
    this.retryStrategies.set('NETWORK', {
      maxRetries: 5,
      backoffTime: 5000, // 5 seconds
      shouldRetry: (error: Error) => error.message.includes('network'),
      onRetry: async () => {
        // Simple retry without backoff
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    });

    // Storage error strategy
    this.retryStrategies.set('STORAGE', {
      maxRetries: 2,
      backoffTime: 10000, // 10 seconds
      shouldRetry: (error: Error) => error.message.includes('storage'),
      onRetry: async () => {
        // Cleanup before retry
        // Add cleanup logic here
      }
    });
  }

  async initializeProgress(repositoryUrl: string): Promise<void> {
    const progress: IAnalysisProgress = {
      id: repositoryUrl,
      repositoryUrl,
      status: AnalysisStatus.PENDING,
      progress: 0,
      currentStep: 'Initializing',
      startTime: new Date(),
      lastUpdate: new Date()
    };

    this.progressMap.set(repositoryUrl, progress);
    await this.cacheService.cacheProgress(repositoryUrl, 0);
    await this.notificationService.notifyAnalysisStart(repositoryUrl);
  }

  async updateProgress(
    repositoryUrl: string,
    progress: number,
    status?: AnalysisStatus
  ): Promise<void> {
    const currentProgress = this.progressMap.get(repositoryUrl);
    if (!currentProgress) return;

    currentProgress.progress = progress;
    if (status) currentProgress.status = status;

    this.progressMap.set(repositoryUrl, currentProgress);
    await this.cacheService.cacheProgress(repositoryUrl, progress);
    await this.notificationService.notifyAnalysisProgress(repositoryUrl, progress);

    // Update queue position if needed
    if (status === AnalysisStatus.IN_PROGRESS) {
      const position = await this.queueService.getPosition(repositoryUrl);
      await this.notificationService.notifyQueueUpdate(repositoryUrl, position);
    }
  }

  async completeAnalysis(
    repositoryUrl: string,
    result: IAnalysisResult
  ): Promise<void> {
    const progress = this.progressMap.get(repositoryUrl);
    if (!progress) return;

    progress.status = AnalysisStatus.COMPLETED;
    progress.progress = 100;
    progress.completedAt = new Date();
    progress.result = result;

    this.progressMap.set(repositoryUrl, progress);
    await this.cacheService.cacheProgress(repositoryUrl, 100);
    await this.notificationService.notifyAnalysisComplete(repositoryUrl, result);
  }

  async handleError(
    repositoryUrl: string,
    error: Error
  ): Promise<boolean> {
    const progress = this.progressMap.get(repositoryUrl);
    if (!progress) return false;

    // Find applicable retry strategy
    const strategy = this.findRetryStrategy(error);
    if (!strategy) {
      await this.markAsFailed(repositoryUrl, error);
      return false;
    }

    // Check retry attempts
    const attempts = this.retryAttempts.get(repositoryUrl) || 0;
    if (attempts >= strategy.maxRetries) {
      await this.markAsFailed(repositoryUrl, error);
      return false;
    }

    // Increment retry counter
    this.retryAttempts.set(repositoryUrl, attempts + 1);

    // Execute retry strategy
    try {
      await strategy.onRetry(attempts + 1);
      return true;
    } catch (retryError) {
      await this.markAsFailed(repositoryUrl, retryError instanceof Error ? retryError : new Error(String(retryError)));
      return false;
    }
  }

  private findRetryStrategy(error: Error): ErrorRecoveryStrategy | undefined {
    for (const strategy of this.retryStrategies.values()) {
      if (strategy.shouldRetry(error)) {
        return strategy;
      }
    }
    return undefined;
  }

  private async markAsFailed(repositoryUrl: string, error: Error): Promise<void> {
    const progress = this.progressMap.get(repositoryUrl);
    if (!progress) return;

    progress.status = AnalysisStatus.FAILED;
    progress.error = error instanceof Error ? error : new Error(String(error));

    this.progressMap.set(repositoryUrl, progress);
    await this.notificationService.notifyAnalysisError(repositoryUrl, error);
    await this.cacheService.invalidateProgress(repositoryUrl);
  }

  private calculateBackoff(attempt: number): number {
    // Exponential backoff with jitter
    const base = Math.min(1000 * Math.pow(2, attempt), 30000);
    const jitter = Math.random() * 1000;
    return base + jitter;
  }

  getProgress(repositoryUrl: string): IAnalysisProgress | undefined {
    return this.progressMap.get(repositoryUrl);
  }

  async cleanup(repositoryUrl: string): Promise<void> {
    this.progressMap.delete(repositoryUrl);
    this.retryAttempts.delete(repositoryUrl);
    await this.cacheService.invalidateProgress(repositoryUrl);
  }
} 