import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { MetricsService } from '../services/metrics.service';

/** Assigns a request id (honouring a sane inbound X-Request-Id) and records latency metrics. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request & { id?: string }, res: Response, next: NextFunction) {
    const inbound = req.headers['x-request-id'];
    req.id = typeof inbound === 'string' && /^[\w-]{8,64}$/.test(inbound) ? inbound : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const route = (req.route?.path as string | undefined) ?? 'unmatched';
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.httpDuration.observe({ method: req.method, route: `${req.baseUrl}${route}`, status: String(res.statusCode) }, seconds);
    });
    next();
  }
}
