import { simpleGit, SimpleGit } from 'simple-git';
import { 
  IRepositoryManager, 
  ILocalRepository, 
  ISecurityScanResult,
  IRepositoryStats,
  SecurityFindingType,
  SecuritySeverity,
} from '../../types/repository-processing';
import { RepoStatus } from '../../types/interfaces';
import { NotificationService } from './notification-service';
import { WorkerPool } from './worker-pool';
import logger from '../logger';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

export class RepositoryManager implements IRepositoryManager {
  private git: SimpleGit;
  private repositories: Map<string, ILocalRepository>;
  private baseDir: string;
  private workerPool: WorkerPool;
  private notificationService: NotificationService;

  constructor(
    baseDir: string,
    workerPool: WorkerPool,
    notificationService: NotificationService
  ) {
    this.baseDir = baseDir;
    this.git = simpleGit();
    this.repositories = new Map();
    this.workerPool = workerPool;
    this.notificationService = notificationService;
  }

  async cloneRepository(url: string): Promise<ILocalRepository> {
    const id = this.generateRepositoryId(url);
    const repoPath = path.join(this.baseDir, id);

    try {
      // Create repository record
      const repository: ILocalRepository = {
        id,
        path: repoPath,
        url,
        clonedAt: new Date(),
        lastAccessed: new Date(),
        size: 0,
        status: RepoStatus.CLONING,
      };

      this.repositories.set(id, repository);

      // Clone repository using worker pool
      await this.workerPool.addTask(async () => {
        await fs.mkdir(repoPath, { recursive: true });
        await this.git.clone(url, repoPath);
      });

      // Update repository size
      const size = await this.calculateDirectorySize(repoPath);
      repository.size = size;
      repository.status = RepoStatus.READY;

      // Scan repository for security issues
      const securityStatus = await this.scanRepository(id);
      repository.securityStatus = securityStatus;

      // Notify about successful clone
      await this.notificationService.notify({
        type: 'REPOSITORY_CLONED',
        message: `Repository ${url} cloned successfully`,
        metadata: {
          id,
          size,
          securityStatus: securityStatus.isClean ? 'clean' : 'suspicious',
        },
        timestamp: new Date(),
      });

      return repository;
    } catch (error) {
      logger.error('Failed to clone repository', { error, url });
      throw new Error(`Failed to clone repository: ${error.message}`);
    }
  }

  async getRepository(id: string): Promise<ILocalRepository | null> {
    const repository = this.repositories.get(id);
    if (repository) {
      repository.lastAccessed = new Date();
    }
    return repository || null;
  }

  async cleanupRepository(id: string): Promise<void> {
    const repository = await this.getRepository(id);
    if (!repository) {
      throw new Error('Repository not found');
    }

    try {
      repository.status = RepoStatus.CLEANUP;

      await this.workerPool.addTask(async () => {
        await fs.rm(repository.path, { recursive: true, force: true });
      });

      this.repositories.delete(id);

      await this.notificationService.notify({
        type: 'CLEANUP_COMPLETE',
        message: `Repository ${repository.url} cleaned up`,
        metadata: { id },
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Failed to cleanup repository', { error, id });
      throw new Error(`Failed to cleanup repository: ${error.message}`);
    }
  }

  async scanRepository(id: string): Promise<ISecurityScanResult> {
    const repository = await this.getRepository(id);
    if (!repository) {
      throw new Error('Repository not found');
    }

    try {
      const findings = await this.workerPool.addTask(async () => {
        return this.performSecurityScan(repository.path);
      });

      const result: ISecurityScanResult = {
        scannedAt: new Date(),
        isClean: findings.length === 0,
        findings,
      };

      await this.notificationService.notify({
        type: 'SECURITY_SCAN_COMPLETE',
        message: `Security scan completed for ${repository.url}`,
        metadata: {
          id,
          isClean: result.isClean,
          findingsCount: findings.length,
        },
        timestamp: new Date(),
      });

      return result;
    } catch (error) {
      logger.error('Failed to scan repository', { error, id });
      throw new Error(`Failed to scan repository: ${error.message}`);
    }
  }

  async listRepositories(): Promise<ILocalRepository[]> {
    return Array.from(this.repositories.values());
  }

  async getRepositoryStats(): Promise<IRepositoryStats> {
    const repositories = await this.listRepositories();
    
    const stats: IRepositoryStats = {
      totalRepositories: repositories.length,
      totalSize: repositories.reduce((sum, repo) => sum + repo.size, 0),
      activeClones: repositories.filter(repo => repo.status === RepoStatus.CLONING).length,
      pendingCleanup: repositories.filter(repo => repo.status === RepoStatus.CLEANUP).length,
      securityStats: {
        clean: repositories.filter(repo => repo.securityStatus?.isClean).length,
        suspicious: repositories.filter(repo => repo.securityStatus && !repo.securityStatus.isClean).length,
        malicious: repositories.filter(repo => 
          repo.securityStatus?.findings.some(f => f.severity === SecuritySeverity.CRITICAL)
        ).length,
      },
    };

    return stats;
  }

  private generateRepositoryId(url: string): string {
    return crypto.createHash('sha256').update(url).digest('hex').substring(0, 12);
  }

  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let size = 0;
    const files = await fs.readdir(dirPath, { withFileTypes: true });

    for (const file of files) {
      const filePath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
        if (file.name !== '.git') {
          size += await this.calculateDirectorySize(filePath);
        }
      } else {
        const stats = await fs.stat(filePath);
        size += stats.size;
      }
    }

    return size;
  }

  private async performSecurityScan(repoPath: string): Promise<ISecurityFinding[]> {
    const findings: ISecurityFinding[] = [];
    const files = await fs.readdir(repoPath, { withFileTypes: true });

    for (const file of files) {
      if (file.isFile()) {
        const filePath = path.join(repoPath, file.name);
        const content = await fs.readFile(filePath, 'utf-8');

        // Check for sensitive data
        if (this.containsSensitiveData(content)) {
          findings.push({
            type: SecurityFindingType.SENSITIVE_DATA,
            path: file.name,
            description: 'Potential sensitive data found',
            severity: SecuritySeverity.HIGH,
          });
        }

        // Check for suspicious patterns
        if (this.containsSuspiciousPatterns(content)) {
          findings.push({
            type: SecurityFindingType.SUSPICIOUS_PATTERN,
            path: file.name,
            description: 'Suspicious code pattern detected',
            severity: SecuritySeverity.MEDIUM,
          });
        }
      }
    }

    return findings;
  }

  private containsSensitiveData(content: string): boolean {
    const patterns = [
      /(['"])(?:(?!\1).)*\1\s*(?:=|:)\s*(['"])(?:(?!\2).)*(?:password|secret|key|token|auth)\2/i,
      /-----BEGIN (?:RSA |DSA )?PRIVATE KEY-----/,
      /(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=){2,}/,
    ];

    return patterns.some(pattern => pattern.test(content));
  }

  private containsSuspiciousPatterns(content: string): boolean {
    const patterns = [
      /eval\s*\(/,
      /new\s+Function\s*\(/,
      /require\s*\(\s*(['"])child_process\1\s*\)/,
      /process\.env/,
      /document\.write\s*\(/,
    ];

    return patterns.some(pattern => pattern.test(content));
  }
} 