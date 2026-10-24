import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from './redis.service';
import { SettingKey, settingDefaults, settingSchemas, SettingValue } from './settings.definitions';
import { AppError, ErrorCode } from '../common/errors';

const LOCAL_TTL_MS = 10_000;
const REDIS_TTL_S = 300;

@Injectable()
export class SettingsService {
  private local = new Map<string, { value: unknown; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const hit = this.local.get(key);
    if (hit && Date.now() - hit.at < LOCAL_TTL_MS) return hit.value as SettingValue<K>;

    let value = await this.redis.getJson<SettingValue<K>>(`settings:${key}`).catch(() => null);
    if (!value) {
      const row = await this.prisma.platformSetting.findUnique({ where: { key } });
      const parsed = row ? settingSchemas[key].safeParse(row.value) : null;
      value = (parsed?.success ? parsed.data : settingDefaults[key]) as SettingValue<K>;
      await this.redis.setJson(`settings:${key}`, value, REDIS_TTL_S).catch(() => undefined);
    }
    this.local.set(key, { value, at: Date.now() });
    return value;
  }

  async all() {
    const keys = Object.keys(settingSchemas) as SettingKey[];
    return Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await this.get(k)])));
  }

  async set<K extends SettingKey>(key: K, raw: unknown, actorId: string): Promise<SettingValue<K>> {
    const schema = settingSchemas[key];
    if (!schema) throw AppError.notFound('Setting');
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Invalid setting value', parsed.error.issues);
    const value = parsed.data as Prisma.InputJsonValue;
    await this.prisma.platformSetting.upsert({
      where: { key },
      create: { key, value, updatedById: actorId },
      update: { value, updatedById: actorId },
    });
    this.local.delete(key);
    await this.redis.client.del(`settings:${key}`);
    return parsed.data as SettingValue<K>;
  }

  /** For tests. */
  clearLocalCache() {
    this.local.clear();
  }
}
