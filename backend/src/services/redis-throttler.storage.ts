import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service';

const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) and tonumber(ARGV[3]) > 0 then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return {hits, ttl, blocked}
`;

/** Distributed fixed-window rate limiting shared by all API replicas. */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const k = `throttle:${throttlerName}:${key}`;
    const [hits, ttlMs, blockMs] = (await this.redis.client.eval(SCRIPT, 2, k, `${k}:blocked`, ttl, limit, blockDuration)) as [number, number, number];
    const isBlocked = blockMs > 0 || hits > limit;
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(Math.max(ttlMs, 0) / 1000),
      isBlocked,
      timeToBlockExpire: Math.ceil(Math.max(blockMs, 0) / 1000),
    };
  }
}
