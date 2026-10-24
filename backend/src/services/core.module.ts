import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { SettingsService } from './settings.service';
import { AuditService } from './audit.service';
import { OutboxService } from './outbox.service';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  providers: [RedisService, SettingsService, AuditService, OutboxService, MetricsService],
  exports: [RedisService, SettingsService, AuditService, OutboxService, MetricsService],
})
export class CoreModule {}
