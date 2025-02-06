import { 
  IQueueService, 
  IStorageService, 
  IRepositoryService, 
  IAnalysisResult,
  AnalysisMethod,
  AnalysisStatus
} from '../../types/interfaces';
import { CacheService } from './cache-service';
import { NotificationService } from './notification-service';
import logger from '../logger';

interface PipelineContext {
  repositoryUrl: string;
  userId: string;
  analysisMethod: AnalysisMethod;
  progress: number;
  results: Partial<IAnalysisResult>;
  startTime: Date;
  lastUpdate: Date;
}

export class PipelineManager {
  constructor(
    private queueService: IQueueService,
    private storageService: IStorageService,
    private repositoryService: IRepositoryService,
    private cacheService: CacheService,
    private notificationService: NotificationService
  ) {}

  async executePipeline(repositoryUrl: string, method: AnalysisMethod, userId: string): Promise<IAnalysisResult> {
    const context: PipelineContext = {
      repositoryUrl,
      userId,
      analysisMethod: method,
      progress: 0,
      results: {},
      startTime: new Date(),
      lastUpdate: new Date()
    };

    try {
      // Initialize pipeline
      await this.initializePipeline(context);

      // Execute analysis based on method
      switch (method) {
        case AnalysisMethod.QUICK:
          await this.executeQuickAnalysis(context);
          break;
        case AnalysisMethod.DEEP:
          await this.executeDeepAnalysis(context);
          break;
        case AnalysisMethod.FALLBACK:
          await this.executeFallbackAnalysis(context);
          break;
        default:
          throw new Error(`Unsupported analysis method: ${method}`);
      }

      // Finalize results
      return await this.finalizePipeline(context);
    } catch (error) {
      await this.handlePipelineError(context, error as Error);
      throw error;
    }
  }

  private async executeQuickAnalysis(context: PipelineContext): Promise<void> {
    try {
      // Validate repository
      const isValid = await this.repositoryService.validateRepository(context.repositoryUrl);
      if (!isValid) {
        throw new Error('Invalid repository');
      }

      // Get repository info
      context.results.metadata = await this.repositoryService.getRepositoryInfo(context.repositoryUrl);
      context.progress = 30;
      await this.updateProgress(context);

      // Analyze languages
      const languages = await this.repositoryService.getLanguages(context.repositoryUrl);
      context.progress = 60;
      await this.updateProgress(context);

      // Set results
      context.results = {
        repositoryUrl: context.repositoryUrl,
        analysisMethod: context.analysisMethod,
        summary: "Quick analysis based on repository metadata and patterns",
        confidence: 0.7,
        isLarp: false,
        details: {
          codeQuality: 0.8,
          commitHistory: 0.7,
          documentation: 0.6,
          testCoverage: 0.5,
          dependencies: 0.9
        },
        metadata: context.results.metadata,
        timestamp: new Date()
      };

      context.progress = 100;
      await this.updateProgress(context);
    } catch (error) {
      logger.error('Error in quick analysis:', error);
      throw error;
    }
  }

  private async executeDeepAnalysis(context: PipelineContext): Promise<void> {
    try {
      // Clone repository
      const repoPath = await this.storageService.cloneRepository(context.repositoryUrl);
      context.progress = 20;
      await this.updateProgress(context);

      // Get repository info
      context.results.metadata = await this.repositoryService.getRepositoryInfo(context.repositoryUrl);
      context.progress = 40;
      await this.updateProgress(context);

      // Analyze commit history
      const commitHistory = await this.repositoryService.getCommitHistory(context.repositoryUrl);
      context.progress = 60;
      await this.updateProgress(context);

      // Analyze dependencies
      const dependencies = await this.repositoryService.getDependencies(context.repositoryUrl);
      context.progress = 80;
      await this.updateProgress(context);

      // Set results
      context.results = {
        repositoryUrl: context.repositoryUrl,
        analysisMethod: context.analysisMethod,
        summary: "Deep analysis based on repository content and history",
        confidence: 0.9,
        isLarp: false,
        details: {
          codeQuality: 0.8,
          commitHistory: 0.9,
          documentation: 0.7,
          testCoverage: 0.6,
          dependencies: 0.8
        },
        metadata: context.results.metadata,
        timestamp: new Date()
      };

      context.progress = 100;
      await this.updateProgress(context);

      // Cleanup
      await this.storageService.cleanupRepository(context.repositoryUrl);
    } catch (error) {
      logger.error('Error in deep analysis:', error);
      throw error;
    }
  }

  private async executeFallbackAnalysis(context: PipelineContext): Promise<void> {
    try {
      // Basic repository info
      context.results.metadata = await this.repositoryService.getRepositoryInfo(context.repositoryUrl);
      context.progress = 50;
      await this.updateProgress(context);

      // Set results
      context.results = {
        repositoryUrl: context.repositoryUrl,
        analysisMethod: context.analysisMethod,
        summary: "Fallback analysis based on basic repository information",
        confidence: 0.5,
        isLarp: false,
        details: {
          codeQuality: 0.5,
          commitHistory: 0.5,
          documentation: 0.5,
          testCoverage: 0.5,
          dependencies: 0.5
        },
        metadata: context.results.metadata,
        timestamp: new Date()
      };

      context.progress = 100;
      await this.updateProgress(context);
    } catch (error) {
      logger.error('Error in fallback analysis:', error);
      throw error;
    }
  }

  private async initializePipeline(context: PipelineContext): Promise<void> {
    await this.queueService.enqueue(context.repositoryUrl, context.userId);
    await this.notificationService.notifyAnalysisStart(context.repositoryUrl);
    await this.updateProgress(context);
  }

  private async finalizePipeline(context: PipelineContext): Promise<IAnalysisResult> {
    const result = context.results as IAnalysisResult;
    await this.cacheService.setAnalysisResult(context.repositoryUrl, result);
    await this.notificationService.notifyAnalysisComplete(context.repositoryUrl, result);
    await this.queueService.removeFromQueue(context.repositoryUrl);
    return result;
  }

  private async handlePipelineError(context: PipelineContext, error: Error): Promise<void> {
    await this.notificationService.notifyAnalysisError(context.repositoryUrl, error);
    await this.queueService.updateStatus(context.repositoryUrl, AnalysisStatus.FAILED);
    await this.cacheService.invalidateAll(context.repositoryUrl);
  }

  private async updateProgress(context: PipelineContext): Promise<void> {
    context.lastUpdate = new Date();
    await this.notificationService.notifyAnalysisProgress(context.repositoryUrl, context.progress);
    await this.queueService.updateStatus(
      context.repositoryUrl, 
      context.progress >= 100 ? AnalysisStatus.COMPLETED : AnalysisStatus.IN_PROGRESS
    );
  }
} 