import { INotification, NotificationType } from '../../types/interfaces';
import logger from '../logger';

type NotificationCallback = (notification: INotification) => Promise<void>;

export class NotificationService {
  private subscribers: Map<NotificationType, NotificationCallback[]>;
  private notifications: INotification[];

  constructor() {
    this.subscribers = new Map();
    this.notifications = [];
    
    // Initialize subscriber lists for each notification type
    Object.values(NotificationType).forEach(type => {
      this.subscribers.set(type, []);
    });
  }

  async initialize(): Promise<void> {
    // Any async initialization can be done here
    logger.debug('Notification service initialized');
  }

  subscribe(type: NotificationType, callback: NotificationCallback): void {
    const subscribers = this.subscribers.get(type) || [];
    subscribers.push(callback);
    this.subscribers.set(type, subscribers);
    logger.debug(`Subscribed to ${type} notifications`);
  }

  unsubscribe(type: NotificationType, callback: NotificationCallback): void {
    const subscribers = this.subscribers.get(type) || [];
    const index = subscribers.indexOf(callback);
    if (index > -1) {
      subscribers.splice(index, 1);
      this.subscribers.set(type, subscribers);
      logger.debug(`Unsubscribed from ${type} notifications`);
    }
  }

  async notify(notification: INotification): Promise<void> {
    this.notifications.push(notification);
    
    const subscribers = this.subscribers.get(notification.type) || [];
    const notificationPromises = subscribers.map(callback => {
      return callback(notification).catch(error => {
        logger.error('Error in notification callback:', error);
      });
    });

    await Promise.all(notificationPromises);
    logger.debug(`Sent ${notification.type} notification to ${subscribers.length} subscribers`);
  }

  getNotifications(): INotification[] {
    return [...this.notifications];
  }

  clearNotifications(): void {
    this.notifications = [];
    logger.debug('Cleared all notifications');
  }

  // Helper methods for common notifications
  async notifyAnalysisStart(repositoryUrl: string): Promise<void> {
    await this.notify({
      type: NotificationType.ANALYSIS_START,
      message: 'Analysis started',
      metadata: { repositoryUrl },
      timestamp: new Date()
    });
  }

  async notifyAnalysisProgress(repositoryUrl: string, progress: number): Promise<void> {
    await this.notify({
      type: NotificationType.ANALYSIS_PROGRESS,
      message: `Analysis ${Math.round(progress * 100)}% complete`,
      metadata: { repositoryUrl, progress },
      timestamp: new Date()
    });
  }

  async notifyAnalysisComplete(repositoryUrl: string, result: any): Promise<void> {
    await this.notify({
      type: NotificationType.ANALYSIS_COMPLETE,
      message: 'Analysis completed',
      metadata: { repositoryUrl, result },
      timestamp: new Date()
    });
  }

  async notifyAnalysisError(repositoryUrl: string, error: Error): Promise<void> {
    await this.notify({
      type: NotificationType.ANALYSIS_ERROR,
      message: error.message,
      metadata: { repositoryUrl, error: error.stack },
      timestamp: new Date()
    });
  }

  async notifyQueueUpdate(repositoryUrl: string, position: number): Promise<void> {
    await this.notify({
      type: NotificationType.QUEUE_UPDATE,
      message: `Queue position updated to ${position}`,
      metadata: { repositoryUrl, position },
      timestamp: new Date()
    });
  }
} 