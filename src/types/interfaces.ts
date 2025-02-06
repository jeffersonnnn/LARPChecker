import { PrismaClient } from '@prisma/client';

export interface ITwitterAuth {
  username: string;
  password: string;
}

export interface IAnalysisResult {
  repositoryUrl: string;
  analysisMethod: AnalysisMethod;
  summary: string;
  confidence: number;
  isLarp: boolean;
  details: {
    codeQuality: number;
    commitHistory: number;
    documentation: number;
    testCoverage: number;
    dependencies: number;
  };
  metadata: IRepositoryMetadata;
  timestamp: Date;
}

export interface IGitHubService {
  getRepositoryContent(repoUrl: string): Promise<string>;
  isValidRepository(repoUrl: string): Promise<boolean>;
}

export interface ITwitterService {
  initialize(): Promise<void>;
  authenticate(auth: ITwitterAuth): Promise<void>;
  tweet(content: string, replyToId?: string): Promise<string>;
  reply(mention: IMention, content: string): Promise<void>;
  onMention(callback: (mention: IMention) => Promise<void>): void;
  listenForMentions(callback: (mention: IMention) => Promise<void>): void;
  stopListening(): void;
}

export interface IAIService {
  analyzeCode(code: string): Promise<IAnalysisResult>;
}

export interface IMention {
  id: string;
  text: string;
  author: string;
  repositoryUrl?: string;
}

export interface IQueueConfig {
  maxRetries: number;          // Maximum number of retry attempts
  retryDelay: number;          // Delay between retries in milliseconds
  maxConcurrent: number;       // Maximum concurrent processing
  priorityLevels: number;      // Number of priority levels
  defaultPriority: number;     // Default priority level
  processingTimeout: number;   // Timeout for processing in milliseconds
}

export interface IQueueMetrics {
  totalItems: number;          // Total items in queue
  processingItems: number;     // Items currently processing
  failedItems: number;         // Items that failed
  averageWaitTime: number;     // Average wait time in milliseconds
  averageProcessingTime: number; // Average processing time in milliseconds
  maxConcurrent: number;
}

export interface IQueueService {
  enqueue(repositoryUrl: string, userId: string): Promise<void>;
  dequeue(): Promise<string | null>;
  updateStatus(repositoryUrl: string, status: AnalysisStatus): Promise<void>;
  getPosition(repositoryUrl: string): Promise<number>;
  getQueueLength(): Promise<number>;
  isQueued(repositoryUrl: string): Promise<boolean>;
  removeFromQueue(repositoryUrl: string): Promise<void>;
  clearQueue(): Promise<void>;
  getMetrics(): Promise<IQueueMetrics>;
  getItemsByStatus(status: string): Promise<IQueueItem[]>;
  cancel(id: string): Promise<void>;
}

export interface ICommit {
  id?: string;
  sha: string;
  message: string;
  author: string;
  timestamp: Date;
  additions: number;
  deletions: number;
  files: number;
  repositoryUrl: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IDependency {
  id?: string;
  name: string;
  version: string;
  type: DependencyType;
  source: string;
  repositoryUrl: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export enum DependencyType {
  PRODUCTION = 'PRODUCTION',
  DEVELOPMENT = 'DEVELOPMENT'
}

export interface IRepositoryService {
  getRepositoryInfo(repositoryUrl: string): Promise<IRepositoryMetadata>;
  validateRepository(repositoryUrl: string): Promise<boolean>;
  getCommitHistory(repositoryUrl: string): Promise<ICommit[]>;
  getDependencies(repositoryUrl: string): Promise<IDependency[]>;
  getLanguages(repositoryUrl: string): Promise<{ [key: string]: number }>;
  getMetadata(repositoryUrl: string): Promise<IRepositoryMetadata>;
  updateMetadata(url: string, metadata: Partial<IRepositoryMetadata>): Promise<void>;
  shouldUseClone(url: string): Promise<boolean>;
  getRateLimit(type: RateLimitType): Promise<IRateLimit>;
  updateRateLimit(type: RateLimitType, limit: IRateLimit): Promise<void>;
}

export interface IQueueItem {
  id: string;
  repositoryUrl: string;
  status: QueueStatus;
  priority: number;
  userId: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface IRepositoryMetadata {
  id?: string;
  url: string;
  owner: string;
  name: string;
  description?: string;
  stars: number;
  forks: number;
  issues: number;
  size: number;
  lastCommit: Date | null;
  contributors: number;
  languages: { [key: string]: number };
  topics: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IRateLimit {
  id?: string;
  type: RateLimitType;
  remaining: number;
  limit: number;
  reset: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export enum QueueStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum RateLimitType {
  GITHUB_API = 'GITHUB_API',
  GITHUB_SEARCH = 'GITHUB_SEARCH',
  OPENAI_API = 'OPENAI_API',
  TWITTER_API = 'TWITTER_API'
}

export interface IStorageConfig {
  maxRepoSize: number;        // Maximum size of a single repository in bytes
  totalStorageQuota: number;  // Total storage quota in bytes
  cleanupThreshold: number;   // Cleanup threshold percentage (e.g., 90 means cleanup at 90% usage)
  retentionPeriod: number;    // How long to keep cloned repos in milliseconds
  concurrentClones: number;   // Maximum number of concurrent clone operations
}

export interface IStorageMetrics {
  totalSize: number;          // Total size of all repositories in bytes
  repoCount: number;          // Number of repositories currently stored
  oldestRepo: Date;          // Timestamp of oldest repository
  newestRepo: Date;          // Timestamp of newest repository
  availableSpace: number;     // Available space in bytes
}

export interface IRepoMetadata {
  path: string;              // Local path to the repository
  url: string;               // Original repository URL
  clonedAt: Date;           // When the repository was cloned
  lastAccessed: Date;       // When the repository was last accessed
  size: number;             // Size of the repository in bytes
  status: RepoStatus;       // Current status of the repository
  error?: string;           // Error message if any
}

export enum RepoStatus {
  CLONING = 'CLONING',
  READY = 'READY',
  ANALYZING = 'ANALYZING',
  ERROR = 'ERROR',
  CLEANUP = 'CLEANUP'
}

export interface IStorageService {
  cloneRepository(repositoryUrl: string): Promise<string>;
  cleanupRepository(repositoryUrl: string): Promise<void>;
  getRepositoryPath(repositoryUrl: string): string;
  initializeStorage(): Promise<void>;
  getStorageUsage(): Promise<number>;
  cleanup(): Promise<void>;
  getMetrics(): Promise<IStorageMetrics>;
  getTotalQuota(): number;
  getRepoMetadata(): Promise<IRepoMetadata[]>;
  validateStorageQuota(): Promise<boolean>;
}

export interface IAnalysisOrchestrator {
  startAnalysis(repositoryUrl: string, userId: string, priority?: number): Promise<string>;
  getAnalysisStatus(id: string): Promise<AnalysisStatus>;
  cancelAnalysis(id: string): Promise<void>;
  getProgress(id: string): Promise<IAnalysisProgress>;
}

export interface IAnalysisProgress {
  id: string;
  repositoryUrl: string;
  status: AnalysisStatus;
  progress: number;
  currentStep: string;
  startTime: Date;
  lastUpdate: Date;
  completedAt?: Date;
  result?: IAnalysisResult;
  error?: Error;
}

export enum AnalysisStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum AnalysisMethod {
  QUICK = 'quick',
  DEEP = 'deep',
  FALLBACK = 'fallback'
}

export interface IGitHubAnalyzer {
  analyzeRepository(url: string): Promise<IRepositoryAnalysis>;
  analyzeCommitHistory(url: string): Promise<ICommitAnalysis>;
  getRepositoryMetrics(url: string): Promise<IRepositoryMetrics>;
  validateRepository(url: string): Promise<IRepositoryValidation>;
}

export interface IRepositoryAnalysis {
  size: number;
  files: number;
  languages: { [key: string]: number };
  dependencies: {
    direct: string[];
    dev: string[];
  };
  complexity: {
    averageFileSize: number;
    maxFileSize: number;
    totalLines: number;
    averageComplexity: number;
  };
}

export interface ICommitAnalysis {
  totalCommits: number;
  contributors: {
    username: string;
    commits: number;
    additions: number;
    deletions: number;
    firstCommit: Date;
    lastCommit: Date;
  }[];
  frequency: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  patterns: {
    bulkCommits: number;
    timeAnomalies: number;
    emptyCommits: number;
  };
}

export interface IRepositoryMetrics {
  stars: number;
  forks: number;
  watchers: number;
  issues: {
    total: number;
    open: number;
    closed: number;
    avgResolutionTime: number;
  };
  pullRequests: {
    total: number;
    open: number;
    merged: number;
    avgMergeTime: number;
  };
  activity: {
    commits: number;
    releases: number;
    lastRelease?: Date;
    lastCommit?: Date;
    lastIssue?: Date;
    lastPR?: Date;
  };
}

export interface IRepositoryValidation {
  isValid: boolean;
  size: number;
  exceedsLimit: boolean;
  hasRequiredFiles: boolean;
  isArchived: boolean;
  isFork: boolean;
  errors?: string[];
}

export interface IGitHubTokenManager {
  getToken(): Promise<string>;
  rotateToken(): Promise<void>;
  getRateLimitInfo(): Promise<{
    remaining: number;
    reset: Date;
    limit: number;
  }>;
}

export interface INotification {
  type: NotificationType;
  message: string;
  metadata: Record<string, any>;
  timestamp: Date;
}

export enum NotificationType {
  ANALYSIS_START = 'ANALYSIS_START',
  ANALYSIS_PROGRESS = 'ANALYSIS_PROGRESS',
  ANALYSIS_COMPLETE = 'ANALYSIS_COMPLETE',
  ANALYSIS_ERROR = 'ANALYSIS_ERROR',
  ANALYSIS_RETRY = 'ANALYSIS_RETRY',
  QUEUE_UPDATE = 'QUEUE_UPDATE'
}

export interface ResourceMetrics {
  available: boolean;
  storageUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  queueMetrics: {
    length: number;
    active: number;
    maxConcurrent: number;
    averageWaitTime: number;
  };
  activeAnalyses: number;
  rateLimits: Map<RateLimitType, IRateLimit>;
  systemHealth: {
    cpuUsage: number;
    memoryUsage: number;
    isHealthy: boolean;
  };
}

export class ResourceError extends Error {
  constructor(
    message: string,
    public readonly code: ResourceErrorCode,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ResourceError';
  }
}

export enum ResourceErrorCode {
  STORAGE_FULL = 'STORAGE_FULL',
  QUEUE_FULL = 'QUEUE_FULL',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_LOCKED = 'RESOURCE_LOCKED',
  RESOURCE_INVALID = 'RESOURCE_INVALID',
  CLEANUP_FAILED = 'CLEANUP_FAILED',
  SYSTEM_ERROR = 'SYSTEM_ERROR'
}

export interface ISessionService {
  // Session management
  createSession(userId: string): Promise<string>;
  getSession(sessionId: string): Promise<{ userId: string; createdAt: Date } | null>;
  invalidateSession(sessionId: string): Promise<void>;
  isValidSession(sessionId: string): Promise<boolean>;
  
  // Cookie management
  saveCookies(cookies: any): Promise<void>;
  loadCookies(): Promise<any>;
  clearCookies(): Promise<void>;
}

export interface ICacheService {
  initialize(): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  invalidateAll(repositoryUrl: string): Promise<void>;
  invalidateProgress(repositoryUrl: string): Promise<void>;
}

export interface ILanguage {
  id?: string;
  name: string;
  bytes: number;
  repositoryUrl: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ServiceType = 
  | PrismaClient 
  | IQueueService 
  | IStorageService 
  | IRepositoryService 
  | ITwitterService 
  | IGitHubService 
  | IAIService 
  | ISessionService;

export type ServiceKey = 
  | 'prisma'
  | 'queue'
  | 'storage'
  | 'repository'
  | 'twitter'
  | 'github'
  | 'ai'
  | 'session'; 