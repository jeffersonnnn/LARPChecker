import { PrismaClient } from '@prisma/client';
import { 
  ITwitterAuth, 
  IMention, 
  IAnalysisResult, 
  IQueueService, 
  IStorageService, 
  IRepositoryService, 
  IGitHubService,
  ITwitterService,
  IAIService,
  AnalysisMethod 
} from './types/interfaces';
import { ServiceContainer } from './services/container';
import logger from './services/logger';
import { PipelineManager } from './services/repository-processing/pipeline-manager';
import { ResourceManager } from './services/repository-processing/resource-manager';
import { StatusManager } from './services/repository-processing/status-manager';
import { CacheService } from './services/repository-processing/cache-service';
import { NotificationService } from './services/repository-processing/notification-service';
import fs from 'fs/promises';
import path from 'path';

export class LARPCheckApp {
  private container: ServiceContainer;
  private prisma!: PrismaClient;
  private githubService!: IGitHubService;
  private twitterService!: ITwitterService;
  private aiService!: IAIService;
  private queueService!: IQueueService;
  private storageService!: IStorageService;
  private repositoryService!: IRepositoryService;
  private pipelineManager!: PipelineManager;
  private resourceManager!: ResourceManager;
  private statusManager!: StatusManager;
  private cacheService!: CacheService;
  private notificationService!: NotificationService;

  constructor() {
    this.container = ServiceContainer.getInstance();
  }

  async initialize(): Promise<void> {
    try {
      // Ensure storage directories exist
      const storagePath = process.env.STORAGE_PATH || './storage';
      const sessionPath = process.env.SESSION_PATH || path.join(storagePath, 'sessions');
      await fs.mkdir(storagePath, { recursive: true });
      await fs.mkdir(sessionPath, { recursive: true });

      // Initialize container first
      await this.container.initialize();
      
      // Get all required services
      this.prisma = this.container.getService('prisma');
      this.githubService = this.container.getService('github');
      this.twitterService = this.container.getService('twitter');
      this.aiService = this.container.getService('ai');
      this.queueService = this.container.getService('queue');
      this.storageService = this.container.getService('storage');
      this.repositoryService = this.container.getService('repository');

      // Initialize supporting services
      this.cacheService = new CacheService({
        ttl: 24 * 60 * 60 * 1000, // 24 hours default TTL
        checkPeriod: 60 * 60 // Check for expired items every hour
      });
      await this.cacheService.initialize();
      
      this.notificationService = new NotificationService();
      await this.notificationService.initialize();
      
      // Initialize managers with proper service instances
      this.statusManager = new StatusManager(
        this.queueService, 
        this.notificationService, 
        this.cacheService
      );

      this.resourceManager = new ResourceManager(
        this.storageService, 
        this.queueService, 
        this.repositoryService, 
        this.cacheService
      );
      
      this.pipelineManager = new PipelineManager(
        this.queueService,
        this.storageService,
        this.repositoryService,
        this.cacheService,
        this.notificationService
      );

      // Initialize Twitter service and set up mention handler
      await this.twitterService.initialize();
      this.twitterService.onMention(this.handleMention.bind(this));

      logger.info('App initialized successfully');
    } catch (error) {
      logger.error('Comprehensive initialization failure:', error);
      throw error;
    }
  }

  private async handleMention(mention: IMention): Promise<void> {
    try {
      const repoUrl = mention.text.match(/https:\/\/github\.com\/[\w-]+\/[\w-]+/)?.[0];
      if (!repoUrl) {
        logger.warn('No valid repository URL found in mention');
        return;
      }

      const resources = await this.resourceManager.checkResources();
      if (!resources.available) {
        logger.warn('Resources not available for analysis');
        return;
      }

      await this.statusManager.initializeProgress(repoUrl);

      const result = await this.pipelineManager.executePipeline(repoUrl, AnalysisMethod.QUICK, mention.author);

      await this.twitterService.reply(mention, this.formatAnalysisResult(result));

      await this.statusManager.cleanup(repoUrl);
    } catch (error) {
      logger.error('Error handling mention:', error);
    }
  }

  private formatAnalysisResult(result: IAnalysisResult): string {
    const summary = result.summary.slice(0, 200);
    return `Analysis complete!\n\nSummary: ${summary}\n\nConfidence: ${result.confidence}%`;
  }

  async start(auth: ITwitterAuth): Promise<void> {
    try {
      await this.initialize();
      await this.twitterService.authenticate(auth);
      logger.info('Application started successfully');
    } catch (error) {
      logger.error('Failed to start application:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.container.cleanup();
  }
} 