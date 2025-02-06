import { Octokit } from '@octokit/rest';
import { 
  IGitHubService,
  IRepositoryService,
  IStorageService,
  RateLimitType,
} from '../types/interfaces';
import logger from './logger';
import fs from 'fs/promises';
import path from 'path';

export class GitHubService implements IGitHubService {
  private octokit: Octokit;
  private repositoryService: IRepositoryService;
  private storageService: IStorageService;

  constructor(
    repositoryService: IRepositoryService, 
    storageService: IStorageService,
  ) {
    this.repositoryService = repositoryService;
    this.storageService = storageService;
    this.octokit = new Octokit({ auth: process.env.GITHUB_PRIMARY_TOKEN });
  }

  private parseRepoUrl(url: string): { owner: string; repo: string } {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      throw new Error('Invalid GitHub repository URL');
    }
    return { owner: match[1], repo: match[2].replace('.git', '') };
  }

  async isValidRepository(repoUrl: string): Promise<boolean> {
    try {
      const { owner, repo } = this.parseRepoUrl(repoUrl);
      const { data } = await this.octokit.repos.get({ owner, repo });

      // Update repository metadata
      await this.repositoryService.updateMetadata(repoUrl, {
        url: repoUrl,
        owner: data.owner.login,
        name: data.name,
        description: data.description || undefined,
        stars: data.stargazers_count,
        forks: data.forks_count,
        size: data.size,
        lastCommit: new Date(data.updated_at),
      });

      return true;
    } catch (error) {
      logger.error('Error validating repository:', error);
      return false;
    }
  }

  async getRepositoryContent(repoUrl: string): Promise<string> {
    try {
      const useClone = await this.repositoryService.shouldUseClone(repoUrl);

      if (useClone) {
        return this.getContentFromClone(repoUrl);
      } else {
        return this.getContentFromApi(repoUrl);
      }
    } catch (error) {
      logger.error('Error fetching repository content:', error);
      throw new Error('Failed to fetch repository content');
    }
  }

  private async getContentFromApi(repoUrl: string): Promise<string> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    let codeContent = '';

    try {
      // Get repository contents
      const { data: contents } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: '',
      });

      if (!Array.isArray(contents)) {
        throw new Error('Unable to fetch repository contents');
      }

      // Filter for relevant files
      const relevantFiles = contents.filter(file => 
        file.type === 'file' && 
        /\.(py|js|ts|jsx|tsx)$/.test(file.name)
      );

      // Fetch content of each relevant file
      for (const file of relevantFiles) {
        const { data: fileData } = await this.octokit.repos.getContent({
          owner,
          repo,
          path: file.path,
        });

        if ('content' in fileData) {
          const decodedContent = Buffer.from(fileData.content, 'base64').toString();
          codeContent += `\n// File: ${file.path}\n${decodedContent}\n`;
        }
      }

      return codeContent;
    } catch (error) {
      logger.error('Error fetching content from API:', error);
      throw error;
    }
  }

  private async getContentFromClone(repoUrl: string): Promise<string> {
    try {
      // Clone the repository
      const repoPath = await this.storageService.cloneRepository(repoUrl);
      let codeContent = '';

      // Read all relevant files
      const files = await this.findRelevantFiles(repoPath);
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        const relativePath = path.relative(repoPath, file);
        codeContent += `\n// File: ${relativePath}\n${content}\n`;
      }

      // Clean up
      await this.storageService.cleanupRepository(repoPath);

      return codeContent;
    } catch (error) {
      logger.error('Error fetching content from clone:', error);
      throw error;
    }
  }

  private async findRelevantFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    async function walk(directory: string) {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
          await walk(fullPath);
        } else if (entry.isFile() && /\.(py|js|ts|jsx|tsx)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
    }

    await walk(dir);
    return files;
  }
} 