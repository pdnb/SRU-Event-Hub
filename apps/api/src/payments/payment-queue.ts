import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { Env } from '../config/env';

export const PAYMENT_QUEUE = 'payments';
export const JOB_EXPIRE_ORDER = 'expire-order';
export const JOB_EXPIRE_SWEEP = 'expire-sweep';

export const redisConnection = (url: string) => ({ url, maxRetriesPerRequest: null });

/**
 * Producer side of the payment queue. Each order gets a delayed job at its due time; a
 * repeatable sweeper (PaymentExpiryWorker) catches anything missed (Redis flush, downtime).
 * When QUEUE_ENABLED=false (tests) scheduling is a no-op and expiry is driven explicitly.
 */
@Injectable()
export class PaymentQueue implements OnModuleDestroy {
  private readonly logger = new Logger(PaymentQueue.name);
  readonly enabled: boolean;
  readonly queue: Queue | null;

  constructor(config: ConfigService<Env, true>) {
    this.enabled = config.get('QUEUE_ENABLED', { infer: true });
    this.queue = this.enabled
      ? new Queue(PAYMENT_QUEUE, {
          connection: redisConnection(config.get('REDIS_URL', { infer: true })),
          defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
        })
      : null;
  }

  async scheduleExpiry(orderId: string, dueAt: Date) {
    if (!this.queue) return;
    try {
      // Unique id per (order, due) so a rescheduled due date (slip rejected) adds a new job,
      // while retries of the same request do not duplicate it.
      await this.queue.add(JOB_EXPIRE_ORDER, { orderId }, {
        jobId: `expire-${orderId}-${dueAt.getTime()}`,
        delay: Math.max(0, dueAt.getTime() - Date.now()) + 1000,
      });
    } catch (e) {
      // Never fail the business request because Redis is down; the sweeper will expire it.
      this.logger.warn({ orderId, err: String(e) }, 'Could not schedule payment expiry job');
    }
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }
}
