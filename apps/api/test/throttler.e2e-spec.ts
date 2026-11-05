import { randomUUID } from 'node:crypto';
import { RedisThrottlerStorage } from '../src/common/redis-throttler.storage';

/** Redis-backed rate limiting against the real Redis from docker compose. */
describe('RedisThrottlerStorage', () => {
  const storage = new RedisThrottlerStorage(process.env.REDIS_URL!, `throttle-test:${randomUUID()}:`);
  afterAll(() => storage.onModuleDestroy());

  it('counts hits in a window and blocks after the limit', async () => {
    const hit = () => storage.increment('ip-1', 60_000, 3, 5_000, 'default');
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hit());
    expect(results.map((r) => r.totalHits)).toEqual([1, 2, 3, 4]);
    expect(results.map((r) => r.isBlocked)).toEqual([false, false, false, true]);
    expect(results[3]!.timeToBlockExpire).toBeGreaterThanOrEqual(4);
    // still blocked on the next request
    expect((await hit()).isBlocked).toBe(true);
  });

  it('is atomic under concurrency (shared across replicas)', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => storage.increment('ip-2', 60_000, 10, 60_000, 'default')));
    expect(results.filter((r) => !r.isBlocked)).toHaveLength(10);
  });

  it('keys are independent per client', async () => {
    expect((await storage.increment('ip-3', 60_000, 1, 1_000, 'default')).isBlocked).toBe(false);
  });
});
