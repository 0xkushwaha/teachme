/**
 * Peak contention: N students try to reserve the SAME slot at the same instant.
 * Pass condition: exactly one 201; everyone else gets 409 SLOT_UNAVAILABLE; no 5xx.
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE, authHeaders } from './common.js';

const created = new Counter('reservations_created');
const conflicts = new Counter('reservations_conflict');
const errors = new Counter('reservations_error');
const N = Number(__ENV.CONTENDERS || 300);

export const options = {
  scenarios: { contention: { executor: 'per-vu-iterations', vus: N, iterations: 1, maxDuration: '60s' } },
  thresholds: { reservations_created: ['count==1'], reservations_error: ['count==0'] },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const t = http.get(`${BASE}/teachers?q=Load%20Teacher&pageSize=1&sort=newest`).json('data')[0];
  // Next weekday 10:00 IST (04:30 UTC), at least two days out.
  const d = new Date(Date.now() + 2 * 86400000 + Math.floor(Math.random() * 3) * 86400000);
  while ([0].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(4, 30, 0, 0);
  return { teacherId: t.id, subjectId: t.subjects[0].id, startAt: d.toISOString() };
}

export default function (s) {
  const res = http.post(`${BASE}/bookings`, JSON.stringify({ teacherId: s.teacherId, subjectId: s.subjectId, startAt: s.startAt, durationMinutes: 60 }), {
    headers: { ...authHeaders(__VU), 'Idempotency-Key': `lt-contend-${__VU}-${Date.now()}` },
  });
  if (res.status === 201) created.add(1);
  else if (res.status === 409) conflicts.add(1);
  else errors.add(1);
  check(res, { '201 or 409': (r) => r.status === 201 || r.status === 409 });
}
