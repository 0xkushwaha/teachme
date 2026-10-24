/**
 * Booking creation under load: students reserve random slots across load-test teachers, then
 * release them (checkout abandoned). 409s from natural collisions are expected and counted.
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE, authHeaders, pick } from './common.js';

const created = new Counter('reservations_created');
const conflicts = new Counter('reservations_conflict');

export const options = {
  scenarios: { reserve: { executor: 'constant-arrival-rate', rate: Number(__ENV.RATE || 25), timeUnit: '1s', duration: __ENV.DURATION || '2m', preAllocatedVUs: 60, maxVUs: 200 } },
  thresholds: { 'http_req_failed{kind:reserve}': ['rate<0.5'], 'checks': ['rate>0.99'], 'http_req_duration{kind:reserve}': ['p(95)<800'], 'http_req_duration{kind:release}': ['p(95)<800'] },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const teachers = [];
  for (let page = 1; page <= 2; page++) teachers.push(...http.get(`${BASE}/teachers?q=Load%20Teacher&pageSize=100&page=${page}`).json('data'));
  const days = [];
  for (let i = 2; days.length < 4; i++) {
    const d = new Date(Date.now() + i * 86400000);
    if (d.getUTCDay() !== 0) days.push(d.toISOString().slice(0, 10));
  }
  return { teachers: teachers.map((t) => ({ id: t.id, subjectId: t.subjects[0].id })), days };
}

export default function (s) {
  const t = pick(s.teachers);
  // 09:00–18:30 IST on the half hour = 03:30–13:00 UTC
  const half = Math.floor(Math.random() * 20);
  const start = new Date(`${pick(s.days)}T03:30:00Z`).getTime() + half * 30 * 60000;
  const user = Math.floor(Math.random() * 3000);
  const headers = { ...authHeaders(user), 'Idempotency-Key': `lt-w-${__VU}-${__ITER}-${Date.now()}` };
  const res = http.post(`${BASE}/bookings`, JSON.stringify({ teacherId: t.id, subjectId: t.subjectId, startAt: new Date(start).toISOString(), durationMinutes: 60 }), { headers, tags: { kind: 'reserve' } });
  check(res, { 'reserve 201/409': (r) => r.status === 201 || r.status === 409 });
  if (res.status === 201) {
    created.add(1);
    const rel = http.post(`${BASE}/bookings/${res.json('id')}/cancel`, JSON.stringify({ reason: 'load test release' }), { headers: authHeaders(user), tags: { kind: 'release', name: 'POST /bookings/:id/cancel' } });
    check(rel, { 'release 200': (r) => r.status === 200 });
  } else if (res.status === 409) conflicts.add(1);
}
