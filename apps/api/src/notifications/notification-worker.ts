import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type { Env } from '../config/env';
import { redisConnection } from '../payments/payment-queue';
import { NotificationDispatcher } from './notification-dispatcher';
import { NotificationsService } from './notifications.service';

const QUEUE = 'notifications';
const TICK = 'tick';
const REMINDER_EVERY_MS = 10 * 60_000;

/**
 * Drives notifications with one repeatable BullMQ job (every 20 s, run by whichever replica picks it
 * up): dispatch new audit facts → deliver due e-mail/LINE → (every 10 min) day-before reminders.
 * Every step is idempotent, so overlapping runs on several replicas are harmless.
 * With QUEUE_ENABLED=false (tests) nothing runs; tests call the steps directly.
 */
@Injectable()
export class NotificationWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorker.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private lastReminder = 0;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly dispatcher: NotificationDispatcher,
    private readonly notifications: NotificationsService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.config.get('QUEUE_ENABLED', { infer: true })) return;
    const connection = redisConnection(this.config.get('REDIS_URL', { infer: true }));
    this.queue = new Queue(QUEUE, { connection, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 } });
    await this.queue.upsertJobScheduler(TICK, { every: 20_000 }, { name: TICK });
    this.worker = new Worker(QUEUE, () => this.tick(), { connection, concurrency: 1 });
    this.worker.on('failed', (job, err) => this.logger.error({ job: job?.name, err: err.message }, 'Notification tick failed'));
  }

  async tick() {
    const dispatched = await this.dispatcher.runOnce();
    let reminders = 0;
    if (Date.now() - this.lastReminder > REMINDER_EVERY_MS) {
      this.lastReminder = Date.now();
      reminders = await this.dispatcher.reminders();
    }
    const delivery = await this.notifications.deliverDue(100);
    if (dispatched || reminders || delivery.sent || delivery.failed) this.logger.log({ dispatched, reminders, ...delivery }, 'Notifications');
    return { dispatched, reminders, ...delivery };
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
