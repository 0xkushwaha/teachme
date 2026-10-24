import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  readonly bookingEvents = new Counter({
    name: 'booking_events_total',
    help: 'Booking lifecycle events',
    labelNames: ['event'],
    registers: [this.registry],
  });
  readonly paymentEvents = new Counter({
    name: 'payment_events_total',
    help: 'Payment verification / webhook outcomes',
    labelNames: ['event'],
    registers: [this.registry],
  });
  readonly jobEvents = new Counter({
    name: 'job_events_total',
    help: 'Background job outcomes',
    labelNames: ['queue', 'outcome'],
    registers: [this.registry],
  });
  readonly queueWaiting = new Gauge({
    name: 'queue_waiting_jobs',
    help: 'Jobs waiting per queue',
    labelNames: ['queue'],
    registers: [this.registry],
  });
  readonly outboxLag = new Gauge({
    name: 'outbox_pending_events',
    help: 'Undispatched outbox events',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
