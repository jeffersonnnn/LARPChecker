import { Octokit } from '@octokit/rest';
import {
  IGitHubAnalyzer,
  IRepositoryAnalysis,
  ICommitAnalysis,
  IRepositoryMetrics,
  IRepositoryValidation,
  IGitHubTokenManager,
} from '../../types/interfaces';
import logger from '../logger';

export class GitHubAnalyzer implements IGitHubAnalyzer {
  private octokit: Octokit;
  private tokenManager: IGitHubTokenManager;
  private maxRepoSize: number;
  private commitAnalysisLimit: number;

  constructor(tokenManager: IGitHubTokenManager) {
    this.tokenManager = tokenManager;
    this.maxRepoSize = parseInt(process.env.GITHUB_MAX_REPO_SIZE || '500', 10) * 1024; // Convert to KB
    this.commitAnalysisLimit = parseInt(process.env.REPO_COMMIT_ANALYSIS_LIMIT || '1000', 10);
    this.octokit = new Octokit({ auth: process.env.GITHUB_PRIMARY_TOKEN });
  }

  private parseRepoUrl(url: string): { owner: string; repo: string } {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      throw new Error('Invalid GitHub repository URL');
    }
    return { owner: match[1], repo: match[2].replace('.git', '') };
  }

  async analyzeRepository(url: string): Promise<IRepositoryAnalysis> {
    try {
      const { owner, repo } = this.parseRepoUrl(url);
      const token = await this.tokenManager.getToken();
      this.octokit = new Octokit({ auth: token });

      const [repoData, languages, contents] = await Promise.all([
        this.octokit.repos.get({ owner, repo }),
        this.octokit.repos.listLanguages({ owner, repo }),
        this.octokit.repos.getContent({ owner, repo, path: '' }),
      ]);

      // Calculate language percentages
      const totalBytes = Object.values(languages.data).reduce((a, b) => a + b, 0);
      const languagePercentages = Object.entries(languages.data).reduce((acc, [lang, bytes]) => {
        acc[lang] = (bytes / totalBytes) * 100;
        return acc;
      }, {} as { [key: string]: number });

      // Get dependencies if package files exist
      const dependencies = { direct: [], dev: [] };
      if (Array.isArray(contents.data)) {
        const packageJson = contents.data.find(f => f.name === 'package.json');
        if (packageJson) {
          const { data: pkgContent } = await this.octokit.repos.getContent({
            owner,
            repo,
            path: 'package.json',
          });

          if ('content' in pkgContent) {
            const pkg = JSON.parse(Buffer.from(pkgContent.content, 'base64').toString());
            dependencies.direct = Object.keys(pkg.dependencies || {});
            dependencies.dev = Object.keys(pkg.devDependencies || {});
          }
        }
      }

      // Calculate complexity metrics
      const complexity = await this.calculateComplexityMetrics(owner, repo);

      return {
        size: repoData.data.size,
        files: await this.countFiles(owner, repo),
        languages: languagePercentages,
        dependencies,
        complexity,
      };
    } catch (error) {
      logger.error('Failed to analyze repository', { error, url });
      throw new Error('Failed to analyze repository');
    }
  }

  async analyzeCommitHistory(url: string): Promise<ICommitAnalysis> {
    try {
      const { owner, repo } = this.parseRepoUrl(url);
      const token = await this.tokenManager.getToken();
      this.octokit = new Octokit({ auth: token });

      // Get commits with statistics
      const commits = await this.octokit.paginate(this.octokit.repos.listCommits, {
        owner,
        repo,
        per_page: 100,
        page: 1,
      }, (response, done) => {
        if (response.length >= this.commitAnalysisLimit) {
          done();
        }
        return response;
      });

      // Analyze contributors
      const contributorStats = new Map<string, {
        commits: number;
        additions: number;
        deletions: number;
        firstCommit: Date;
        lastCommit: Date;
      }>();

      for (const commit of commits) {
        const author = commit.author?.login || 'unknown';
        const date = new Date(commit.commit.author?.date || '');
        
        const stats = contributorStats.get(author) || {
          commits: 0,
          additions: 0,
          deletions: 0,
          firstCommit: date,
          lastCommit: date,
        };

        stats.commits++;
        if (commit.stats) {
          stats.additions += commit.stats.additions || 0;
          stats.deletions += commit.stats.deletions || 0;
        }
        stats.firstCommit = date < stats.firstCommit ? date : stats.firstCommit;
        stats.lastCommit = date > stats.lastCommit ? date : stats.lastCommit;

        contributorStats.set(author, stats);
      }

      // Calculate commit frequency
      const now = new Date();
      const oldestCommit = new Date(Math.min(...commits.map(c => new Date(c.commit.author?.date || '').getTime())));
      const daysDiff = (now.getTime() - oldestCommit.getTime()) / (1000 * 60 * 60 * 24);

      // Analyze patterns
      const bulkCommits = this.detectBulkCommits(commits);
      const timeAnomalies = this.detectTimeAnomalies(commits);
      const emptyCommits = commits.filter(c => 
        (c.stats?.additions || 0) === 0 && (c.stats?.deletions || 0) === 0
      ).length;

      return {
        totalCommits: commits.length,
        contributors: Array.from(contributorStats.entries()).map(([username, stats]) => ({
          username,
          ...stats,
        })),
        frequency: {
          daily: commits.length / daysDiff,
          weekly: (commits.length / daysDiff) * 7,
          monthly: (commits.length / daysDiff) * 30,
        },
        patterns: {
          bulkCommits,
          timeAnomalies,
          emptyCommits,
        },
      };
    } catch (error) {
      logger.error('Failed to analyze commit history', { error, url });
      throw new Error('Failed to analyze commit history');
    }
  }

  async getRepositoryMetrics(url: string): Promise<IRepositoryMetrics> {
    try {
      const { owner, repo } = this.parseRepoUrl(url);
      const token = await this.tokenManager.getToken();
      this.octokit = new Octokit({ auth: token });

      const [
        repoData,
        issues,
        pullRequests,
        releases,
      ] = await Promise.all([
        this.octokit.repos.get({ owner, repo }),
        this.octokit.issues.listForRepo({ owner, repo, state: 'all' }),
        this.octokit.pulls.list({ owner, repo, state: 'all' }),
        this.octokit.repos.listReleases({ owner, repo }),
      ]);

      // Calculate average issue resolution time
      const closedIssues = issues.data.filter(i => i.state === 'closed' && !i.pull_request);
      const avgResolutionTime = closedIssues.reduce((sum, issue) => {
        const created = new Date(issue.created_at).getTime();
        const closed = new Date(issue.closed_at!).getTime();
        return sum + (closed - created);
      }, 0) / (closedIssues.length || 1);

      // Calculate average PR merge time
      const mergedPRs = pullRequests.data.filter(pr => pr.merged_at);
      const avgMergeTime = mergedPRs.reduce((sum, pr) => {
        const created = new Date(pr.created_at).getTime();
        const merged = new Date(pr.merged_at!).getTime();
        return sum + (merged - created);
      }, 0) / (mergedPRs.length || 1);

      return {
        stars: repoData.data.stargazers_count,
        forks: repoData.data.forks_count,
        watchers: repoData.data.subscribers_count,
        issues: {
          total: issues.data.filter(i => !i.pull_request).length,
          open: issues.data.filter(i => !i.pull_request && i.state === 'open').length,
          closed: closedIssues.length,
          avgResolutionTime,
        },
        pullRequests: {
          total: pullRequests.data.length,
          open: pullRequests.data.filter(pr => pr.state === 'open').length,
          merged: mergedPRs.length,
          avgMergeTime,
        },
        activity: {
          commits: repoData.data.size,
          releases: releases.data.length,
          lastRelease: releases.data[0]?.created_at ? new Date(releases.data[0].created_at) : undefined,
          lastCommit: repoData.data.pushed_at ? new Date(repoData.data.pushed_at) : undefined,
          lastIssue: issues.data[0]?.created_at ? new Date(issues.data[0].created_at) : undefined,
          lastPR: pullRequests.data[0]?.created_at ? new Date(pullRequests.data[0].created_at) : undefined,
        },
      };
    } catch (error) {
      logger.error('Failed to get repository metrics', { error, url });
      throw new Error('Failed to get repository metrics');
    }
  }

  async validateRepository(url: string): Promise<IRepositoryValidation> {
    try {
      const { owner, repo } = this.parseRepoUrl(url);
      const token = await this.tokenManager.getToken();
      this.octokit = new Octokit({ auth: token });

      const repoData = await this.octokit.repos.get({ owner, repo });
      const errors: string[] = [];

      if (repoData.data.size > this.maxRepoSize) {
        errors.push(`Repository size (${repoData.data.size}KB) exceeds limit (${this.maxRepoSize}KB)`);
      }

      if (repoData.data.archived) {
        errors.push('Repository is archived');
      }

      // Check for required files
      const contents = await this.octokit.repos.getContent({ owner, repo, path: '' });
      const hasReadme = Array.isArray(contents.data) && contents.data.some(f => 
        f.name.toLowerCase().includes('readme')
      );
      const hasLicense = Array.isArray(contents.data) && contents.data.some(f => 
        f.name.toLowerCase().includes('license')
      );

      if (!hasReadme) errors.push('Missing README file');
      if (!hasLicense) errors.push('Missing LICENSE file');

      return {
        isValid: errors.length === 0,
        size: repoData.data.size,
        exceedsLimit: repoData.data.size > this.maxRepoSize,
        hasRequiredFiles: hasReadme && hasLicense,
        isArchived: repoData.data.archived,
        isFork: repoData.data.fork,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      logger.error('Failed to validate repository', { error, url });
      throw new Error('Failed to validate repository');
    }
  }

  private async calculateComplexityMetrics(owner: string, repo: string): Promise<IRepositoryAnalysis['complexity']> {
    try {
      const files = await this.octokit.paginate(this.octokit.repos.getContent, {
        owner,
        repo,
        path: '',
      });

      let totalSize = 0;
      let maxFileSize = 0;
      let totalLines = 0;
      let fileCount = 0;

      for (const file of files) {
        if (file.type === 'file' && file.size > 0) {
          totalSize += file.size;
          maxFileSize = Math.max(maxFileSize, file.size);
          
          if ('content' in file) {
            const lines = Buffer.from(file.content, 'base64')
              .toString()
              .split('\n').length;
            totalLines += lines;
          }
          
          fileCount++;
        }
      }

      return {
        averageFileSize: totalSize / (fileCount || 1),
        maxFileSize,
        totalLines,
        averageComplexity: totalLines / (fileCount || 1),
      };
    } catch (error) {
      logger.error('Failed to calculate complexity metrics', { error, owner, repo });
      throw error;
    }
  }

  private async countFiles(owner: string, repo: string): Promise<number> {
    try {
      const response = await this.octokit.repos.get({ owner, repo });
      return response.data.size;
    } catch (error) {
      logger.error('Failed to count files', { error, owner, repo });
      throw error;
    }
  }

  private detectBulkCommits(commits: any[]): number {
    let bulkCommits = 0;
    const BULK_THRESHOLD = 100; // Number of files changed to consider it a bulk commit

    for (const commit of commits) {
      if ((commit.stats?.total || 0) > BULK_THRESHOLD) {
        bulkCommits++;
      }
    }

    return bulkCommits;
  }

  private detectTimeAnomalies(commits: any[]): number {
    let anomalies = 0;
    const commitTimes = commits.map(c => new Date(c.commit.author.date).getHours());
    
    // Check for unusual commit times (between 1 AM and 5 AM)
    for (const time of commitTimes) {
      if (time >= 1 && time <= 5) {
        anomalies++;
      }
    }

    return anomalies;
  }
} 