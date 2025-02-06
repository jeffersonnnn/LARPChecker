import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import { 
  IStorageService, 
  IStorageConfig, 
  IStorageMetrics, 
  IRepoMetadata,
  RepoStatus 
} from '../types/interfaces';
import logger from './logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import { watch } from 'fs';

const execAsync = promisify(exec);

const DEFAULT_CONFIG: IStorageConfig = {
  maxRepoSize: 1024 * 1024 * 1024,     // 1GB
  totalStorageQuota: 10 * 1024 * 1024 * 1024, // 10GB
  cleanupThreshold: 90,                 // 90%
  retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
  concurrentClones: 3,                  // 3 concurrent clones
};

export class StorageService implements IStorageService {
  private baseDir: string;
  private git: SimpleGit;
  private config: IStorageConfig;
  private metadataPath: string;
  private activeClones: Set<string>;
  private repoMetadata: Map<string, IRepoMetadata>;
  private fsWatchers: Map<string, fs.FSWatcher>;

  constructor(config: Partial<IStorageConfig> = {}) {
    this.baseDir = process.env.STORAGE_PATH || path.join(process.cwd(), 'storage');
    this.metadataPath = path.join(this.baseDir, 'metadata.json');
    this.git = simpleGit();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.activeClones = new Set();
    this.repoMetadata = new Map();
    this.fsWatchers = new Map();
  }

  async initializeStorage(): Promise<void> {
    try {
      // Create storage directory if it doesn't exist
      await fsPromises.mkdir(this.baseDir, { recursive: true });
      
      // Load existing metadata
      try {
        const data = await fsPromises.readFile(this.metadataPath, 'utf-8');
        const metadata = JSON.parse(data);
        this.repoMetadata = new Map(Object.entries(metadata));
      } catch (error) {
        logger.info('No existing metadata found, starting fresh');
      }

      // Clean up any repositories that are in an inconsistent state
      await this.cleanupOldRepositories();
      
      logger.info('Storage initialized', { 
        baseDir: this.baseDir,
        config: this.config 
      });
    } catch (error) {
      logger.error('Failed to initialize storage', { error });
      throw new Error('Failed to initialize storage');
    }
  }

  async cloneRepository(repositoryUrl: string): Promise<string> {
    const repoPath = this.getRepositoryPath(repositoryUrl);

    try {
      if (this.activeClones.size >= this.config.concurrentClones) {
        throw new Error('Maximum concurrent clone operations reached');
      }

      const currentUsage = await this.getStorageUsage();
      if (currentUsage >= this.config.totalStorageQuota) {
        throw new Error('Storage quota exceeded');
      }

      this.activeClones.add(repositoryUrl);

      // Clean up if repository already exists
      await this.cleanupRepository(repositoryUrl);

      // Clone the repository
      logger.info('Cloning repository', { repositoryUrl, repoPath });
      await this.git.clone(repositoryUrl, repoPath);

      // Verify size
      const size = await this.getDirectorySize(repoPath);
      if (size > this.config.maxRepoSize) {
        await this.cleanupRepository(repositoryUrl);
        throw new Error('Repository exceeds maximum size limit');
      }

      return repoPath;
    } catch (error) {
      logger.error('Failed to clone repository', { error, repositoryUrl });
      throw new Error('Failed to clone repository');
    } finally {
      this.activeClones.delete(repositoryUrl);
    }
  }

  async cleanupRepository(repositoryUrl: string): Promise<void> {
    const repoPath = this.getRepositoryPath(repositoryUrl);
    try {
      await fsPromises.rm(repoPath, { recursive: true, force: true });
      logger.info('Cleaned up repository', { repositoryUrl });
    } catch (error) {
      logger.error('Failed to cleanup repository', { error, repositoryUrl });
      throw new Error('Failed to cleanup repository');
    }
  }

  getRepositoryPath(repositoryUrl: string): string {
    const repoId = Buffer.from(repositoryUrl).toString('base64').replace(/[/+=]/g, '_');
    return path.join(this.baseDir, repoId);
  }

  async getStorageUsage(): Promise<number> {
    try {
      return await this.getDirectorySize(this.baseDir);
    } catch (error) {
      logger.error('Failed to get storage usage', { error });
      throw new Error('Failed to get storage usage');
    }
  }

  async cleanup(): Promise<void> {
    try {
      const files = await fsPromises.readdir(this.baseDir);
      for (const file of files) {
        const filePath = path.join(this.baseDir, file);
        await fsPromises.rm(filePath, { recursive: true, force: true });
      }
      logger.info('Storage cleaned up');
    } catch (error) {
      logger.error('Failed to cleanup storage', { error });
      throw new Error('Failed to cleanup storage');
    }
  }

  async getMetrics(): Promise<IStorageMetrics> {
    try {
      const repos = Array.from(this.repoMetadata.values());
      const totalSize = repos.reduce((sum, repo) => sum + (repo.size || 0), 0);
      const dates = repos.map(repo => repo.clonedAt);

      return {
        totalSize,
        repoCount: repos.length,
        oldestRepo: dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date(),
        newestRepo: dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date(),
        availableSpace: this.config.totalStorageQuota - totalSize,
      };
    } catch (error) {
      logger.error('Failed to get storage metrics', { error });
      throw new Error('Failed to get storage metrics');
    }
  }

  getTotalQuota(): number {
    return this.config.totalStorageQuota;
  }

  async getRepoMetadata(): Promise<IRepoMetadata[]> {
    return Array.from(this.repoMetadata.values());
  }

  private async getRepoMetadataByUrl(url: string): Promise<IRepoMetadata> {
    const metadata = this.repoMetadata.get(url);
    if (!metadata) {
      throw new Error('Repository metadata not found');
    }
    return metadata;
  }

  async updateRepoMetadata(url: string, metadata: Partial<IRepoMetadata>): Promise<void> {
    try {
      const existing = this.repoMetadata.get(url) || {
        path: this.getRepositoryPath(url),
        url,
        clonedAt: new Date(),
        lastAccessed: new Date(),
        size: 0,
        status: RepoStatus.CLONING,
      };

      this.repoMetadata.set(url, { ...existing, ...metadata });

      // Save metadata to disk
      await fsPromises.writeFile(
        this.metadataPath,
        JSON.stringify(Object.fromEntries(this.repoMetadata)),
        'utf-8'
      );
    } catch (error) {
      logger.error('Failed to update repository metadata', { error, url });
      throw new Error('Failed to update repository metadata');
    }
  }

  async cleanupOldRepositories(): Promise<void> {
    try {
      const now = new Date().getTime();
      const repos = Array.from(this.repoMetadata.entries());

      // Sort by last accessed time
      repos.sort(([, a], [, b]) => a.lastAccessed.getTime() - b.lastAccessed.getTime());

      for (const [url, metadata] of repos) {
        // Skip if repository is being cloned
        if (metadata.status === RepoStatus.CLONING) continue;

        // Clean up if:
        // 1. Repository is older than retention period
        // 2. Repository is in error state
        // 3. We need to free up space
        const age = now - metadata.lastAccessed.getTime();
        const metrics = await this.getMetrics();
        const usagePercentage = (metrics.totalSize / this.config.totalStorageQuota) * 100;

        if (age > this.config.retentionPeriod ||
            metadata.status === RepoStatus.ERROR ||
            usagePercentage > this.config.cleanupThreshold) {
          await this.cleanupRepository(url);
          this.repoMetadata.delete(url);
        }
      }

      logger.info('Cleaned up old repositories');
    } catch (error) {
      logger.error('Failed to cleanup old repositories', { error });
      throw new Error('Failed to cleanup old repositories');
    }
  }

  async isRepositoryValid(repoPath: string): Promise<boolean> {
    try {
      // Check if path exists and is a directory
      const stats = await fsPromises.stat(repoPath);
      if (!stats.isDirectory()) return false;

      // Check if it's a git repository
      const gitPath = path.join(repoPath, '.git');
      const gitStats = await fsPromises.stat(gitPath);
      return gitStats.isDirectory();
    } catch {
      return false;
    }
  }

  async validateStorageQuota(): Promise<boolean> {
    try {
      const metrics = await this.getMetrics();
      return metrics.totalSize < this.config.totalStorageQuota;
    } catch (error) {
      logger.error('Failed to validate storage quota', { error });
      return false;
    }
  }

  async monitorRepository(path: string): Promise<void> {
    try {
      // Stop existing watcher if any
      const existingWatcher = this.fsWatchers.get(path);
      if (existingWatcher) {
        existingWatcher.close();
      }

      // Start new watcher
      const watcher = watch(path, { recursive: true }, async (eventType, filename) => {
        try {
          // Update last accessed time
          const url = Array.from(this.repoMetadata.entries())
            .find(([_, meta]) => meta.path === path)?.[0];
          
          if (url) {
            const size = await this.getDirectorySize(path);
            await this.updateRepoMetadata(url, {
              lastAccessed: new Date(),
              size,
            });
          }
        } catch (error) {
          logger.error('Error in repository monitor', { error, path });
        }
      });

      this.fsWatchers.set(path, watcher);
      logger.info('Started monitoring repository', { path });
    } catch (error) {
      logger.error('Failed to start repository monitoring', { error, path });
      throw new Error('Failed to start repository monitoring');
    }
  }

  private async getDirectorySize(dirPath: string): Promise<number> {
    try {
      const stats = await fsPromises.stat(dirPath);
      if (!stats.isDirectory()) {
        return stats.size;
      }

      const files = await fsPromises.readdir(dirPath);
      const sizes = await Promise.all(
        files.map(file => this.getDirectorySize(path.join(dirPath, file)))
      );

      return sizes.reduce((total, size) => total + size, 0);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return 0;
      }
      throw error;
    }
  }

  private async handleError(operation: string, error: Error): Promise<never> {
    logger.error('Storage operation failed', {
      operation,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }

  private async isGitRepository(repoPath: string): Promise<boolean> {
    const gitPath = path.join(repoPath, '.git');
    try {
      const stats = await fsPromises.stat(gitPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
} 