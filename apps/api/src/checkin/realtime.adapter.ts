import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { Env } from '../config/env';

/**
 * Socket.IO server options (spec §4.8 real-time counters).
 *  - same CORS allow-list as the REST API (dev: web :3000 → api :4000; prod: one origin behind Nginx);
 *  - the Redis adapter fans events out across API replicas, so a scan on one instance reaches
 *    dashboards connected to another. Skipped in tests (single process, no extra connections).
 */
export class RealtimeAdapter extends IoAdapter {
  private readonly log = new Logger(RealtimeAdapter.name);
  private pub?: Redis;
  private sub?: Redis;

  constructor(private readonly ctx: INestApplicationContext) {
    super(ctx);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const config = this.ctx.get(ConfigService<Env, true>);
    const origins = config.get('CORS_ORIGINS', { infer: true }).split(',').map((o) => o.trim());
    const server = super.createIOServer(port, {
      ...options,
      path: '/socket.io',
      cors: { origin: origins, credentials: true },
      // Bound memory per connection; clients only send tiny subscribe messages.
      maxHttpBufferSize: 16_384,
    }) as Server;
    if (config.get('NODE_ENV', { infer: true }) !== 'test' && !this.pub) {
      const url = config.get('REDIS_URL', { infer: true });
      this.pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null });
      this.sub = this.pub.duplicate();
      this.pub.on('error', (e) => this.log.warn(`realtime redis: ${e.message}`));
      this.sub.on('error', (e) => this.log.warn(`realtime redis: ${e.message}`));
      server.adapter(createAdapter(this.pub, this.sub));
    }
    return server;
  }

  override async close(server: Server) {
    await super.close(server);
    await Promise.allSettled([this.pub?.quit(), this.sub?.quit()]);
  }
}
