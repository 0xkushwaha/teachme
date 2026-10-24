import { Controller, Get, Headers, Res, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../services/redis.service';
import { MetricsService } from '../services/metrics.service';
import { AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import { safeEqual } from '../utils/crypto';

@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: the process is up. */
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. Load balancers should route only to ready instances. */
  @Get('health/ready')
  async ready() {
    const checks: Record<string, string> = {};
    await Promise.all([
      this.prisma.$queryRaw`SELECT 1`
        .then(() => (checks.database = 'ok'))
        .catch(() => (checks.database = 'down')),
      this.redis.client
        .ping()
        .then(() => (checks.redis = 'ok'))
        .catch(() => (checks.redis = 'down')),
    ]);
    if (Object.values(checks).some((v) => v !== 'ok'))
      throw new ServiceUnavailableException({ status: 'degraded', checks });
    return { status: 'ok', checks };
  }
}

/** Prometheus scrape endpoint at /metrics (outside /api and versioning); blocked at the ingress. */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller({ version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: AppConfig,
  ) {}

  /** Bearer-token protected when METRICS_TOKEN is set. */
  @Get('metrics')
  async scrape(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    const token = this.config.env.METRICS_TOKEN;
    if (token && !(auth && safeEqual(auth, `Bearer ${token}`))) throw AppError.unauthenticated();
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}
