import { RepoStatus } from './interfaces';

export interface ILocalRepository {
  id: string;
  path: string;
  url: string;
  clonedAt: Date;
  lastAccessed: Date;
  size: number;
  status: RepositoryStatus;
  securityScanResult?: ISecurityScanResult;
}

export interface ISecurityScanResult {
  id: string;
  repositoryId: string;
  scannedAt: Date;
  issues: SecurityIssue[];
  sensitiveFiles: string[];
  suspiciousPatterns: SuspiciousPattern[];
}

export interface SecurityIssue {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  location: string;
}

export interface SuspiciousPattern {
  pattern: string;
  matches: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  description: string;
}

export enum RepositoryStatus {
  CLONING = 'CLONING',
  READY = 'READY',
  ERROR = 'ERROR',
  SCANNING = 'SCANNING',
  CLEANUP = 'CLEANUP',
}

export interface IRepositoryManager {
  cloneRepository(url: string): Promise<ILocalRepository>;
  getRepository(id: string): Promise<ILocalRepository | null>;
  cleanupRepository(id: string): Promise<void>;
  scanRepository(id: string): Promise<ISecurityScanResult>;
  listRepositories(): Promise<ILocalRepository[]>;
  getRepositoryStats(): Promise<IRepositoryStats>;
}

export interface IRepositoryStats {
  totalRepositories: number;
  totalSize: number;
  activeClones: number;
  pendingCleanup: number;
  securityStats: {
    clean: number;
    suspicious: number;
    malicious: number;
  };
}

export interface IWorkerPool {
  size: number;
  activeWorkers: number;
  queueSize: number;
  addTask<T>(task: () => Promise<T>, priority?: number): Promise<T>;
  shutdown(): Promise<void>;
}

export interface IQueueWorker {
  id: string;
  status: WorkerStatus;
  completedTasks: number;
  errors: number;
  currentTask?: string;
  startedAt?: Date;
}

export enum WorkerStatus {
  IDLE = 'IDLE',
  BUSY = 'BUSY',
  ERROR = 'ERROR',
  SHUTDOWN = 'SHUTDOWN',
}

export interface INotification {
  type: string;
  message: string;
  metadata?: Record<string, any>;
  timestamp: Date;
} 
