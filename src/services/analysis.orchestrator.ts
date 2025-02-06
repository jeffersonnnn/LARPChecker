import { 
  IAnalysisOrchestrator,
  IAnalysisProgress,
  AnalysisStatus,
  IQueueService,
  IGitHubService,
  IAIService,
  IStorageService,
  IRepositoryService,
  QueueStatus,
} from '../types/interfaces';
import { AnalysisRouter, AnalysisMethod } from './repository-processing/analysis-router';
import { NotificationService } from './repository-processing/notification-service';
import logger from './logger';

export class AnalysisOrchestrator implements IAnalysisOrchestrator {
  private queueService: IQueueService;
  private githubService: IGitHubService;
  private aiService: IAIService;
  private storageService: IStorageService;
  private repositoryService: IRepositoryService;
  private analysisRouter: AnalysisRouter;
  private progressMap: Map<string, IAnalysisProgress>;

  constructor(
    queueService: IQueueService,
    githubService: IGitHubService,
    aiService: IAIService,
    storageService: IStorageService,
    repositoryService: IRepositoryService,
    notificationService: NotificationService
  ) {
    this.queueService = queueService;
    this.githubService = githubService;
    this.aiService = aiService;
    this.storageService = storageService;
    this.repositoryService = repositoryService;
    this.progressMap = new Map();

    // Initialize analysis router
    this.analysisRouter = new AnalysisRouter(
      repositoryService,
      githubService,
      storageService,
      notificationService
    );

    // Listen for queue status updates
    this.queueService.addStatusListener(this.handleQueueStatusUpdate.bind(this));
  }

  async startAnalysis(repositoryUrl: string, userId: string, priority?: number): Promise<string> {
    try {
      // Validate repository first
      if (!(await this.githubService.isValidRepository(repositoryUrl))) {
        throw new Error('Invalid or inaccessible repository');
      }

      // Determine analysis method
      const route = await this.analysisRouter.determineAnalysisMethod(repositoryUrl);
      
      if (route.method === AnalysisMethod.FAILED) {
        throw new Error(route.reason);
      }

      // Enqueue the analysis request
      const queueId = await this.queueService.enqueue(repositoryUrl, userId, priority);

      // Initialize progress tracking
      this.progressMap.set(queueId, {
        id: queueId,
        status: AnalysisStatus.PENDING,
        progress: 0,
        currentStep: 'Queued for analysis',
        analysisMethod: route.method,
        fallbackAvailable: route.fallbackAvailable,
      });

      // Start processing queue if not already processing
      this.processQueue();

      return queueId;
    } catch (error) {
      logger.error('Failed to start analysis', { error, repositoryUrl });
      throw new Error('Failed to start analysis');
    }
  }

  async getAnalysisStatus(id: string): Promise<AnalysisStatus> {
    const progress = this.progressMap.get(id);
    if (!progress) {
      throw new Error('Analysis not found');
    }
    return progress.status;
  }

  async cancelAnalysis(id: string): Promise<void> {
    try {
      await this.queueService.cancel(id);
      const progress = this.progressMap.get(id);
      if (progress) {
        progress.status = AnalysisStatus.CANCELLED;
        progress.currentStep = 'Analysis cancelled';
      }
    } catch (error) {
      logger.error('Failed to cancel analysis', { error, id });
      throw new Error('Failed to cancel analysis');
    }
  }

  async getProgress(id: string): Promise<IAnalysisProgress> {
    const progress = this.progressMap.get(id);
    if (!progress) {
      throw new Error('Analysis not found');
    }

    // Update queue position if pending
    if (progress.status === AnalysisStatus.PENDING) {
      progress.queuePosition = await this.queueService.getPosition(id);
      
      // Estimate time remaining based on position and average processing time
      const metrics = await this.queueService.getMetrics();
      if (progress.queuePosition && metrics.averageProcessingTime > 0) {
        progress.estimatedTimeRemaining = 
          progress.queuePosition * metrics.averageProcessingTime;
      }
    }

    return progress;
  }

  private async handleQueueStatusUpdate(item: IQueueItem): Promise<void> {
    const progress = this.progressMap.get(item.id);
    if (!progress) return;

    switch (item.status) {
      case QueueStatus.PROCESSING:
        progress.status = AnalysisStatus.IN_PROGRESS;
        progress.startedAt = item.startedAt;
        break;
      case QueueStatus.COMPLETED:
        progress.status = AnalysisStatus.COMPLETED;
        progress.completedAt = item.completedAt;
        progress.progress = 100;
        break;
      case QueueStatus.FAILED:
        progress.status = AnalysisStatus.FAILED;
        progress.error = item.error;
        break;
      case QueueStatus.CANCELLED:
        progress.status = AnalysisStatus.CANCELLED;
        break;
    }
  }

  private async processQueue(): Promise<void> {
    try {
      const item = await this.queueService.dequeue();
      if (!item) return;

      const progress = this.progressMap.get(item.id);
      if (!progress) return;

      try {
        // Update progress
        progress.currentStep = 'Determining analysis method';
        progress.progress = 10;

        // Determine analysis method
        const route = await this.analysisRouter.determineAnalysisMethod(item.repositoryUrl);
        
        if (route.method === AnalysisMethod.FAILED) {
          throw new Error(route.reason);
        }

        // Update progress with chosen method
        progress.currentStep = `Analyzing via ${route.method}`;
        progress.progress = 20;
        progress.analysisMethod = route.method;
        progress.fallbackAvailable = route.fallbackAvailable;

        // Execute analysis
        const content = await this.analysisRouter.executeAnalysis(
          item.repositoryUrl,
          route.method
        );

        // Analyze code
        progress.currentStep = 'Running AI analysis';
        progress.progress = 80;
        const result = await this.aiService.analyzeCode(content);

        // Update progress
        progress.currentStep = 'Finalizing analysis';
        progress.progress = 90;
        progress.result = result;

        // Mark as completed
        await this.queueService.updateStatus(item.id, QueueStatus.COMPLETED);

        progress.currentStep = 'Analysis completed';
        progress.progress = 100;
      } catch (error) {
        logger.error('Error processing queue item', { error, itemId: item.id });
        
        // Check if we can try fallback
        if (progress.fallbackAvailable && progress.analysisMethod === AnalysisMethod.API) {
          progress.currentStep = 'Attempting fallback to clone';
          progress.progress = 30;
          
          try {
            const content = await this.analysisRouter.executeAnalysis(
              item.repositoryUrl,
              AnalysisMethod.CLONE
            );

            // Analyze code with fallback content
            progress.currentStep = 'Running AI analysis';
            progress.progress = 80;
            const result = await this.aiService.analyzeCode(content);

            // Update progress
            progress.currentStep = 'Finalizing analysis';
            progress.progress = 90;
            progress.result = result;

            // Mark as completed
            await this.queueService.updateStatus(item.id, QueueStatus.COMPLETED);

            progress.currentStep = 'Analysis completed (via fallback)';
            progress.progress = 100;
          } catch (fallbackError) {
            logger.error('Fallback analysis failed', { error: fallbackError, itemId: item.id });
            await this.queueService.updateStatus(
              item.id,
              QueueStatus.FAILED,
              `Analysis failed (including fallback): ${fallbackError.message}`
            );
          }
        } else {
          await this.queueService.updateStatus(
            item.id,
            QueueStatus.FAILED,
            error.message
          );
        }
      }

      // Continue processing queue
      setImmediate(() => this.processQueue());
    } catch (error) {
      logger.error('Error in queue processing', { error });
      // Retry processing after delay
      setTimeout(() => this.processQueue(), 5000);
    }
  }
} 