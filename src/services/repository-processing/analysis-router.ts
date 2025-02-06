import { 
  IRepositoryService,
  IGitHubService,
  IStorageService,
  IRepositoryMetadata,
  IAnalysisResult,
  AnalysisMethod  
} from '../../types/interfaces';
import { NotificationService } from './notification-service';
import logger from '../logger';


interface AnalysisStrategy {
  analyze(repositoryUrl: string): Promise<IAnalysisResult>;
  canHandle(metadata: IRepositoryMetadata): Promise<boolean>;
}

export class AnalysisRouter {
  private strategies: Map<AnalysisMethod, AnalysisStrategy>;
  private repositoryService: IRepositoryService;
  private githubService: IGitHubService;
  private storageService: IStorageService;
  private notificationService: NotificationService;

  constructor(
    repositoryService: IRepositoryService,
    githubService: IGitHubService,
    storageService: IStorageService,
    notificationService: NotificationService
  ) {
    this.repositoryService = repositoryService;
    this.githubService = githubService;
    this.storageService = storageService;
    this.notificationService = notificationService;
    this.strategies = new Map();

    // Register analysis strategies
    this.registerStrategies();
  }

  private registerStrategies() {
    // Quick Analysis Strategy - For small repos or initial checks
    this.strategies.set(AnalysisMethod.QUICK, {
      async analyze(repositoryUrl: string): Promise<IAnalysisResult> {
        // Implement quick analysis logic
        return {
          isLarp: false,
          explanation: "Quick analysis completed",
          confidence: 0.5
        };
      },
      async canHandle(metadata: IRepositoryMetadata): Promise<boolean> {
        // Handle small repositories or those needing quick analysis
        return metadata.size < 1000000; // Less than 1MB
      }
    });

    // Deep Analysis Strategy - For complex repositories
    this.strategies.set(AnalysisMethod.DEEP, {
      async analyze(repositoryUrl: string): Promise<IAnalysisResult> {
        // Implement deep analysis logic
        return {
          isLarp: false,
          explanation: "Deep analysis completed",
          confidence: 0.8
        };
      },
      async canHandle(metadata: IRepositoryMetadata): Promise<boolean> {
        // Handle larger repositories that need detailed analysis
        return metadata.size >= 1000000; // 1MB or larger
      }
    });

    // Fallback Strategy - When other methods fail
    this.strategies.set(AnalysisMethod.FALLBACK, {
      async analyze(repositoryUrl: string): Promise<IAnalysisResult> {
        // Implement fallback analysis logic
        return {
          isLarp: false,
          explanation: "Fallback analysis completed",
          confidence: 0.3
        };
      },
      async canHandle(metadata: IRepositoryMetadata): Promise<boolean> {
        // Always available as fallback
        return true;
      }
    });
  }

  async routeAnalysis(repositoryUrl: string): Promise<IAnalysisResult> {
    try {
      // Get repository metadata
      const metadata = await this.repositoryService.getMetadata(repositoryUrl);
      
      // Try strategies in order: QUICK -> DEEP -> FALLBACK
      for (const method of [AnalysisMethod.QUICK, AnalysisMethod.DEEP, AnalysisMethod.FALLBACK]) {
        const strategy = this.strategies.get(method);
        if (!strategy) continue;

        if (await strategy.canHandle(metadata)) {
          logger.info(`Using ${method} analysis for repository`, { url: repositoryUrl });
          
          try {
            const result = await strategy.analyze(repositoryUrl);
            await this.notificationService.notifyAnalysisComplete(repositoryUrl, result);
            return result;
          } catch (error) {
            logger.error(`${method} analysis failed:`, error);
            continue; // Try next strategy
          }
        }
      }

      throw new Error('No suitable analysis strategy found');
    } catch (error) {
      logger.error('Analysis routing failed:', error);
      throw error;
    }
  }

  async getPreferredMethod(metadata: IRepositoryMetadata): Promise<AnalysisMethod> {
    for (const [method, strategy] of this.strategies) {
      if (await strategy.canHandle(metadata)) {
        return method;
      }
    }
    return AnalysisMethod.FALLBACK;
  }
} 