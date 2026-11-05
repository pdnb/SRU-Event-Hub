import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import type { Env } from '../config/env';
import { RegistrationsService } from '../registrations/registrations.service';
import { JOB_EXPIRE_ORDER, JOB_EXPIRE_SWEEP, PAYMENT_QUEUE, PaymentQueue, redisConnection } from './payment-queue';

/**
 * Consumer for the payment queue:
 *  - `expire-order`  delayed job per order, fires at its due time
 *  - `expire-sweep`  repeatable job every minute (safety net for lost/late jobs)
 * Both call the same idempotent, row-locked expiry routine, so running several API
 * replicas (each with a worker) is safe.
 */
@Injectable()
export class PaymentExpiryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentExpiryWorker.name);
  private worker: Worker | null = null;

  constructor(
    private readonly queue: PaymentQueue,
    private readonly registrations: RegistrationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap() {
    if (!this.queue.enabled || !this.queue.queue) return;
    await this.queue.queue.upsertJobScheduler(JOB_EXPIRE_SWEEP, { every: 60_000 }, { name: JOB_EXPIRE_SWEEP });
    this.worker = new Worker(
      PAYMENT_QUEUE,
      async (job) => {
        if (job.name === JOB_EXPIRE_ORDER) {
          return { expired: await this.registrations.expireOrder(String(job.data.orderId)) };
        }
        if (job.name === JOB_EXPIRE_SWEEP) {
          const n = await this.registrations.expireOverdue();
          if (n) this.logger.log({ expired: n }, 'Payment expiry sweep');
          return { expired: n };
        }
        return null;
      },
      { connection: redisConnection(this.config.get('REDIS_URL', { infer: true })), concurrency: 4 },
    );
    this.worker.on('failed', (job, err) => this.logger.error({ job: job?.name, id: job?.id, err: err.message }, 'Payment job failed'));
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
