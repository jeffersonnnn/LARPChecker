import { 
  IWorkerPool, 
  IQueueWorker, 
  WorkerStatus,
} from '../../types/repository-processing';
import { NotificationService } from './notification-service';
import logger from '../logger';
import { v4 as uuidv4 } from 'uuid';

interface QueueItem<T> {
  id: string;
  task: () => Promise<T>;
  priority: number;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  addedAt: Date;
}

export class WorkerPool implements IWorkerPool {
  private workers: Map<string, IQueueWorker>;
  private queue: QueueItem<any>[];
  private maxWorkers: number;
  private notificationService: NotificationService;
  private isShuttingDown: boolean;

  constructor(maxWorkers: number, notificationService: NotificationService) {
    this.maxWorkers = maxWorkers;
    this.workers = new Map();
    this.queue = [];
    this.notificationService = notificationService;
    this.isShuttingDown = false;

    // Initialize workers
    for (let i = 0; i < maxWorkers; i++) {
      this.createWorker();
    }
  }

  get size(): number {
    return this.maxWorkers;
  }

  get activeWorkers(): number {
    return Array.from(this.workers.values()).filter(
      w => w.status === WorkerStatus.BUSY
    ).length;
  }

  get queueSize(): number {
    return this.queue.length;
  }

  async addTask<T>(task: () => Promise<T>, priority: number = 1): Promise<T> {
    if (this.isShuttingDown) {
      throw new Error('Worker pool is shutting down');
    }

    return new Promise((resolve, reject) => {
      const queueItem: QueueItem<T> = {
        id: uuidv4(),
        task,
        priority,
        resolve,
        reject,
        addedAt: new Date(),
      };

      // Add to queue and sort by priority
      this.queue.push(queueItem);
      this.queue.sort((a, b) => b.priority - a.priority);

      // Notify about queue update
      this.notificationService.notify({
        type: 'QUEUE_UPDATE',
        message: 'New task added to queue',
        metadata: {
          queueSize: this.queue.length,
          activeWorkers: this.activeWorkers,
        },
        timestamp: new Date(),
      });

      // Try to process queue
      this.processQueue();
    });
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Wait for all active tasks to complete
    const activeWorkers = Array.from(this.workers.values())
      .filter(w => w.status === WorkerStatus.BUSY);

    logger.info('Shutting down worker pool', {
      activeWorkers: activeWorkers.length,
      queueSize: this.queue.length,
    });

    // Mark all workers as shutting down
    for (const worker of this.workers.values()) {
      worker.status = WorkerStatus.SHUTDOWN;
    }

    // Clear the queue
    this.queue = [];
  }

  private createWorker(): IQueueWorker {
    const worker: IQueueWorker = {
      id: uuidv4(),
      status: WorkerStatus.IDLE,
      completedTasks: 0,
      errors: 0,
    };

    this.workers.set(worker.id, worker);
    return worker;
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) return;

    // Find available worker
    const availableWorker = Array.from(this.workers.values())
      .find(w => w.status === WorkerStatus.IDLE);

    if (!availableWorker) return;

    // Get next task
    const queueItem = this.queue.shift();
    if (!queueItem) return;

    try {
      // Update worker status
      availableWorker.status = WorkerStatus.BUSY;
      availableWorker.currentTask = queueItem.id;
      availableWorker.startedAt = new Date();

      // Execute task
      const result = await queueItem.task();

      // Update worker stats
      availableWorker.completedTasks++;
      availableWorker.status = WorkerStatus.IDLE;
      availableWorker.currentTask = undefined;
      availableWorker.startedAt = undefined;

      // Resolve promise
      queueItem.resolve(result);

      // Process next item in queue
      this.processQueue();
    } catch (error) {
      // Update worker stats
      availableWorker.errors++;
      availableWorker.status = WorkerStatus.ERROR;
      availableWorker.currentTask = undefined;
      availableWorker.startedAt = undefined;

      // Notify about error
      await this.notificationService.notify({
        type: 'WORKER_ERROR',
        message: `Worker ${availableWorker.id} encountered an error`,
        metadata: {
          workerId: availableWorker.id,
          error: error.message,
          taskId: queueItem.id,
        },
        timestamp: new Date(),
      });

      // Reject promise
      queueItem.reject(error);

      // Reset worker status and process next item
      setTimeout(() => {
        availableWorker.status = WorkerStatus.IDLE;
        this.processQueue();
      }, 1000); // Wait 1 second before processing next task
    }
  }
} 