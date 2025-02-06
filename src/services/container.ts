import { PrismaClient } from '@prisma/client';
import { 
  IQueueService, 
  IStorageService, 
  IRepositoryService,
  ITwitterService,
  IGitHubService,
  IAIService,
  ISessionService,
  ServiceKey
} from '../types/interfaces';
import { QueueService } from './queue.service';
import { StorageService } from './storage.service';
import { RepositoryService } from './repository.service';
import { TwitterService } from './twitter.service';
import { GitHubService } from './github.service';
import { AIService } from './ai.service';
import { SessionService } from './session.service';
import logger from './logger';

// Service implementation type mapping
type ServiceMap = {
  prisma: PrismaClient;
  queue: QueueService;
  storage: StorageService;
  repository: RepositoryService;
  twitter: TwitterService;
  github: GitHubService;
  ai: AIService;
  session: SessionService;
};

// Service interface type mapping
type InterfaceMap = {
  prisma: PrismaClient;
  queue: IQueueService;
  storage: IStorageService;
  repository: IRepositoryService;
  twitter: ITwitterService;
  github: IGitHubService;
  ai: IAIService;
  session: ISessionService;
};

// Type guard to ensure service implements interface
type VerifyImplementation<TImpl, TInterface> = TImpl extends TInterface 
  ? TImpl 
  : never;

export class ServiceContainer {
  private static instance: ServiceContainer;
  private services: Map<ServiceKey, ServiceMap[ServiceKey]>;
  private initialized: boolean = false;
  private initializing: boolean = false;
  private initializationOrder: ServiceKey[] = [
    'prisma',
    'session',
    'storage',
    'queue',
    'repository',
    'github',
    'twitter',
    'ai'
  ];

  private constructor() {
    this.services = new Map();
  }

  static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer();
    }
    return ServiceContainer.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return;

    try {
      this.initializing = true;
      
      // Initialize services in dependency order
      for (const serviceName of this.initializationOrder) {
        await this.initializeService(serviceName);
      }

      this.initialized = true;
      this.initializing = false;
      logger.info('Service container initialized');
    } catch (error) {
      this.initializing = false;
      logger.error('Failed to initialize service container:', error);
      throw error;
    }
  }

  private async initializeService(name: ServiceKey): Promise<void> {
    if (this.services.has(name)) return;

    try {
      let service: ServiceMap[ServiceKey];

      switch (name) {
        case 'prisma': {
          const prisma = new PrismaClient();
          await prisma.$connect();
          service = prisma;
          break;
        }
        case 'session': {
          service = new SessionService();
          break;
        }
        case 'storage': {
          service = new StorageService();
          break;
        }
        case 'queue': {
          const prisma = this.getService('prisma');
          service = new QueueService(prisma);
          break;
        }
        case 'repository': {
          const prisma = this.getService('prisma');
          service = new RepositoryService(prisma);
          break;
        }
        case 'github': {
          const repository = this.getService('repository');
          const storage = this.getService('storage');
          service = new GitHubService(repository, storage);
          break;
        }
        case 'twitter': {
          const session = this.getService('session');
          service = new TwitterService(session);
          break;
        }
        case 'ai': {
          service = new AIService();
          break;
        }
        default: {
          throw new Error(`Unknown service: ${name}`);
        }
      }

      this.registerService(name, service);
    } catch (error) {
      logger.error(`Failed to initialize service ${name}:`, error);
      throw error;
    }
  }

  private registerService<K extends ServiceKey>(
    name: K,
    service: VerifyImplementation<ServiceMap[K], InterfaceMap[K]>
  ): void {
    this.services.set(name, service);
  }

  getService<K extends ServiceKey>(name: K): ServiceMap[K] {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service ${name} not found`);
    }

    return service as ServiceMap[K];
  }

  async cleanup(): Promise<void> {
    if (!this.initialized) return;

    try {
      // Cleanup in reverse initialization order
      for (const serviceName of [...this.initializationOrder].reverse()) {
        await this.cleanupService(serviceName);
      }

      this.services.clear();
      this.initialized = false;
      logger.info('Service container cleaned up');
    } catch (error) {
      logger.error('Error during service container cleanup:', error);
      throw error;
    }
  }

  private async cleanupService(name: ServiceKey): Promise<void> {
    const service = this.services.get(name);
    if (!service) return;

    try {
      switch (name) {
        case 'prisma': {
          await (service as PrismaClient).$disconnect();
          break;
        }
        case 'twitter': {
          (service as TwitterService).stopListening();
          break;
        }
        // Add other service-specific cleanup as needed
      }
    } catch (error) {
      logger.error(`Error cleaning up service ${name}:`, error);
      throw error;
    }
  }
} 