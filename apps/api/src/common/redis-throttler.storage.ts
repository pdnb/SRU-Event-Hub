import { Logger, OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

/**
 * Fixed-window counter + block key, evaluated atomically in Redis so every API replica shares the
 * same limits (the default in-memory storage is per process).
 * Returns {hits, msUntilWindowReset, blocked(0|1), msUntilUnblock}.
 */
const SCRIPT = `
local hitsKey, blockKey = KEYS[1], KEYS[2]
local ttl, limit, block = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  return { tonumber(redis.call('GET', hitsKey) or (limit + 1)), redis.call('PTTL', hitsKey), 1, blockTtl }
end
local hits = redis.call('INCR', hitsKey)
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttl) end
local left = redis.call('PTTL', hitsKey)
if left < 0 then redis.call('PEXPIRE', hitsKey, ttl); left = ttl end
if hits > limit then
  local b = block > 0 and block or left
  redis.call('SET', blockKey, '1', 'PX', b)
  return { hits, left, 1, b }
end
return { hits, left, 0, 0 }
`;

export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis;

  constructor(url: string, private readonly prefix = 'throttle:') {
    // Commands queue while (re)connecting, but never hold a request for more than 500 ms.
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 500 });
    this.redis.on('error', (e) => this.logger.warn({ err: e.message }, 'Redis throttler connection error'));
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}${throttlerName}:${key}`;
    try {
      const [hits, left, blocked, unblock] = (await this.redis.eval(SCRIPT, 2, `${base}:hits`, `${base}:block`, ttl, limit, blockDuration)) as number[];
      return {
        totalHits: hits!,
        timeToExpire: Math.max(0, Math.ceil(left! / 1000)),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.max(0, Math.ceil(unblock! / 1000)),
      };
    } catch (e) {
      // Fail open: a Redis outage must not take the whole API down. Nginx limit_req still applies.
      this.logger.warn({ err: String(e) }, 'Throttler storage unavailable – request allowed');
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }
}
