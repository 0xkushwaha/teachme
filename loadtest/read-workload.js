/**
 * Realistic mixed read workload: anonymous browsing, availability lookups, signed-in dashboards,
 * plus a trickle of logins (Argon2id hashing is intentionally expensive).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE, anonHeaders, authHeaders, pick } from './common.js';

const SUBJECTS = ['physics', 'algebra', 'calculus', 'chemistry', 'biology', 'python-programming', 'english', 'economics'];
const DURATION = __ENV.DURATION || '3m';

export const options = {
  scenarios: {
    browse: { executor: 'ramping-vus', exec: 'browse', startVUs: 0, stages: [{ duration: '30s', target: Number(__ENV.BROWSE_VUS || 120) }, { duration: DURATION, target: Number(__ENV.BROWSE_VUS || 120) }, { duration: '15s', target: 0 }] },
    dashboard: { executor: 'constant-vus', exec: 'dashboard', vus: Number(__ENV.DASH_VUS || 80), duration: DURATION, startTime: '30s' },
    auth: { executor: 'constant-arrival-rate', exec: 'auth', rate: Number(__ENV.LOGIN_RATE || 5), timeUnit: '1s', duration: DURATION, preAllocatedVUs: 20, startTime: '30s' },
  },
  thresholds: {
    'http_req_failed{scenario:browse}': ['rate<0.01'],
    'http_req_failed{scenario:dashboard}': ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<500'],
    'http_req_duration{kind:dashboard}': ['p(95)<500'],
    'http_req_duration{kind:login}': ['p(95)<1500'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const res = http.get(`${BASE}/teachers?pageSize=100`);
  const teachers = res.json('data').map((t) => ({ id: t.id, slug: t.slug, duration: t.sessionDurations[0] }));
  return { teachers };
}

export function browse(data) {
  const h = { headers: anonHeaders(), tags: { kind: 'read' } };
  const subject = pick(SUBJECTS);
  check(http.get(`${BASE}/subjects`, h), { 'subjects 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/teachers?subject=${subject}&sort=price_asc&page=1&pageSize=12`, h), { 'search 200': (r) => r.status === 200 });
  const t = pick(data.teachers);
  check(http.get(`${BASE}/teachers/${t.slug}`, h), { 'profile 200': (r) => r.status === 200 });
  const from = new Date();
  const to = new Date(from.getTime() + 7 * 86400000);
  check(http.get(`${BASE}/availability/teachers/${t.id}/slots?from=${from.toISOString()}&to=${to.toISOString()}&durationMinutes=${t.duration}`, h), { 'slots 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
}

export function dashboard() {
  const h = { headers: authHeaders(__VU * 7 + __ITER), tags: { kind: 'dashboard' } };
  check(http.get(`${BASE}/auth/me`, h), { 'me 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/students/me/overview`, h), { 'overview 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/bookings?scope=past&page=1&pageSize=10`, h), { 'bookings 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/notifications/unread-count`, h), { 'unread 200': (r) => r.status === 200 });
  sleep(2 + Math.random() * 3);
}

export function auth() {
  const n = Math.floor(Math.random() * 3000);
  const res = http.post(`${BASE}/auth/token`, JSON.stringify({ email: `lt-student-${n}@load.test`, password: 'Load-Test-Pass-2026' }), {
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `172.16.${n % 250}.${(n >> 8) + 1}` },
    tags: { kind: 'login' },
  });
  check(res, { 'login 200': (r) => r.status === 200 });
}
