/**
 * Razorpay webhook ingestion: HMAC-signed events at a sustained rate, ~20% duplicates
 * (Razorpay retries). Verifies signature checking + idempotent recording under load.
 */
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';
import { BASE } from './common.js';

const SECRET = __ENV.WEBHOOK_SECRET || 'lt_webhook_secret';

export const options = {
  scenarios: { webhooks: { executor: 'constant-arrival-rate', rate: Number(__ENV.RATE || 50), timeUnit: '1s', duration: __ENV.DURATION || '1m', preAllocatedVUs: 40, maxVUs: 150 } },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<300'] },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const dup = Math.random() < 0.2;
  const id = dup ? `evt_lt_dup_${__VU % 20}` : `evt_lt_${__VU}_${__ITER}_${Date.now()}`;
  const body = JSON.stringify({ event: 'payment.captured', created_at: Math.floor(Date.now() / 1000), payload: { payment: { entity: { id: `pay_lt${__ITER}`, order_id: `order_unknown_${__VU}`, amount: 100000, currency: 'INR', status: 'captured' } } } });
  const res = http.post(`${BASE}/payments/razorpay/webhook`, body, {
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': crypto.hmac('sha256', SECRET, body, 'hex'), 'X-Razorpay-Event-Id': id },
  });
  check(res, { 'webhook 200': (r) => r.status === 200 });
}
