import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { PipelineManager } from '../services/repository-processing/pipeline-manager';
import { ResourceManager } from '../services/repository-processing/resource-manager';
import { StatusManager } from '../services/repository-processing/status-manager';
import { CacheService } from '../services/repository-processing/cache-service';
import { NotificationService } from '../services/repository-processing/notification-service';
import { AnalysisMethod } from '../types/interfaces';
import { ServiceContainer } from '../services/container';
import { setupTest } from './setup';
import { 
  IQueueService, 
  IStorageService, 
  IRepositoryService, 
  IAnalysisResult, 
  ResourceMetrics,
  IRepositoryMetadata,
  AnalysisStatus
} from '../types/interfaces';

// Set up test environment
setupTest();

// Mock repository metadata
const mockRepositoryMetadata = {
  owner: 'testuser',
  name: 'test-repo',
  description: 'Test repository',
  stars: 100,
  forks: 50,
  issues: 10,
  lastCommit: new Date(),
  contributors: 5,
  languages: { TypeScript: 1000 },
  topics: ['ai', 'test'],
  url: 'https://github.com/testuser/test-repo',
  size: 1000
};

// Mock services
const mockQueueService = {
  enqueue: jest.fn().mockImplementation(async () => {}),
  dequeue: jest.fn().mockImplementation(async () => 'test-repo'),
  updateStatus: jest.fn().mockImplementation(async () => {}),
  getPosition: jest.fn().mockImplementation(async () => 1),
  getQueueLength: jest.fn().mockImplementation(async () => 1),
  isQueued: jest.fn().mockImplementation(async () => false),
  removeFromQueue: jest.fn().mockImplementation(async () => {}),
  clearQueue: jest.fn().mockImplementation(async () => {})
} as unknown as IQueueService;

const mockStorageService = {
  cloneRepository: jest.fn().mockImplementation(async () => '/test/path'),
  cleanupRepository: jest.fn().mockImplementation(async () => {}),
  getRepositoryPath: jest.fn().mockImplementation(() => '/test/path'),
  initializeStorage: jest.fn().mockImplementation(async () => {}),
  getStorageUsage: jest.fn().mockImplementation(async () => 1000),
  cleanup: jest.fn().mockImplementation(async () => {})
} as unknown as IStorageService;

const mockRepositoryService = {
  getRepositoryInfo: jest.fn().mockImplementation(async () => mockRepositoryMetadata),
  validateRepository: jest.fn().mockImplementation(async () => true),
  getCommitHistory: jest.fn().mockImplementation(async () => []),
  getDependencies: jest.fn().mockImplementation(async () => []),
  getLanguages: jest.fn().mockImplementation(async () => ({ TypeScript: 100 }))
} as unknown as IRepositoryService;

describe('Analysis Pipeline', () => {
  let container: ServiceContainer;
  let pipelineManager: PipelineManager;
  let resourceManager: ResourceManager;
  let statusManager: StatusManager;
  let cacheService: CacheService;
  let notificationService: NotificationService;

  beforeEach(async () => {
    // Initialize services
    container = ServiceContainer.getInstance();
    await container.initialize();

    cacheService = new CacheService();
    notificationService = new NotificationService();
    statusManager = new StatusManager(mockQueueService, notificationService, cacheService);
    resourceManager = new ResourceManager(mockStorageService, mockQueueService, mockRepositoryService, cacheService);
    
    pipelineManager = new PipelineManager(
      mockQueueService,
      mockStorageService,
      mockRepositoryService,
      cacheService,
      notificationService
    );
  });

  test('should execute quick analysis pipeline successfully', async () => {
    const testRepo = 'https://github.com/example/test-repo';
    const testUserId = 'test-user-123';
    
    // Initialize progress tracking
    await statusManager.initializeProgress(testRepo);

    // Check resources
    const resources = await resourceManager.checkResources();
    expect(resources.storageUsage).toBeDefined();
    expect(resources.queueMetrics).toBeDefined();
    expect(resources.activeAnalyses).toBeDefined();
    expect(resources.rateLimits).toBeDefined();

    // Execute pipeline
    const result = await pipelineManager.executePipeline(testRepo, AnalysisMethod.QUICK, testUserId);
    expect(result).toBeDefined();
    expect((result as IAnalysisResult).repositoryUrl).toBe(testRepo);
    expect((result as IAnalysisResult).analysisMethod).toBe(AnalysisMethod.QUICK);

    // Verify notifications were sent
    const notifications = notificationService.getNotifications();
    expect(notifications).toContainEqual(
      expect.objectContaining({
        type: 'ANALYSIS_START',
        metadata: expect.objectContaining({
          repositoryUrl: testRepo
        })
      })
    );

    // Verify cache was updated
    const cachedResult = await cacheService.getAnalysisResult(testRepo);
    expect(cachedResult).toBeDefined();
    expect(cachedResult?.repositoryUrl).toBe(testRepo);

    // Clean up
    await Promise.all([
      statusManager.cleanup(testRepo),
      resourceManager.cleanup(),
      cacheService.invalidateAll(testRepo)
    ]);
  });
}); 