import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../config/app-config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: AppConfig) {
    this.client = new Redis(config.env.REDIS_URL, { maxRetriesPerRequest: 3, enableReadyCheck: true });
  }

  /** Dedicated connection for BullMQ (requires maxRetriesPerRequest = null). */
  static bullConnection(url: string) {
    return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
