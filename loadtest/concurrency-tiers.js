/**
 * Stepped concurrency test: 100 → 500 → 1,000 → 2,000 concurrently active virtual users, each tier
 * held steady and reported separately (k6 tags every request with its scenario = tier).
 *
 * Each VU behaves like one active user with realistic think time (3–8 s between page views):
 *   55 % anonymous visitors  – subjects, filtered/sorted teacher search, profile, 7-day slots
 *   30 % students            – dashboard, booking history, payments; 1 in 20 iterations logs in
 *                               with a password (Argon2id); 1 in 15 reserves a slot and releases it
 *    10 % teachers           – overview, earnings, ledger, upcoming bookings, application
 *     5 % admins             – overview, teacher queue, booking search, finance summary, payouts
 *
 * Env: TIERS (default "100,500,1000,2000"), HOLD (default "2m"), RAMP (default "30s").
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';
import { BASE, pick } from './common.js';

const students = new SharedArray('students', () => JSON.parse(open('/results/tokens.json')));
const teachers = new SharedArray('teachers', () => JSON.parse(open('/results/teacher-tokens.json')));
const admins = new SharedArray('admins', () => JSON.parse(open('/results/admin-tokens.json')));

const reserved = new Counter('reservations_created');
const SUBJECTS = ['physics', 'algebra', 'calculus', 'chemistry', 'biology', 'python-programming', 'english', 'economics'];
const SORTS = ['recommended', 'price_asc', 'price_desc', 'experience'];
const TIERS = (__ENV.TIERS || '100,500,1000,2000').split(',').map(Number);
const HOLD = __ENV.HOLD || '2m';
const RAMP = __ENV.RAMP || '30s';
const secs = (d) => Number(d.replace(/m$/, '')) * (d.endsWith('m') ? 60 : 1) || Number(d.replace(/s$/, ''));

const scenarios = {};
const thresholds = {};
let offset = 0;
for (const n of TIERS) {
  const name = `t${n}`;
  scenarios[name] = {
    executor: 'ramping-vus',
    startTime: `${offset}s`,
    startVUs: 0,
    stages: [{ duration: RAMP, target: n }, { duration: HOLD, target: n }, { duration: '10s', target: 0 }],
    gracefulRampDown: '10s',
    gracefulStop: '15s',
  };
  // Thresholds double as per-tier sub-metrics in the summary; they are targets, not assumptions.
  thresholds[`http_req_duration{scenario:${name}}`] = ['p(95)<500'];
  thresholds[`http_req_failed{scenario:${name}}`] = ['rate<0.01'];
  thresholds[`http_reqs{scenario:${name}}`] = ['count>0'];
  for (const kind of ['read', 'student', 'teacher', 'admin', 'login', 'reserve']) thresholds[`http_req_duration{scenario:${name},kind:${kind}}`] = ['max>=0'];
  offset += secs(RAMP) + secs(HOLD) + 10 + 20; // 20 s quiet gap between tiers
}

export const options = {
  scenarios,
  thresholds,
  discardResponseBodies: true, // keep k6 memory flat at 2,000 VUs; bodies are parsed only where needed
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  setupTimeout: '60s',
};

export function setup() {
  const list = [];
  for (let page = 1; page <= 2; page++) list.push(...http.get(`${BASE}/teachers?q=Load%20Teacher&pageSize=100&page=${page}`, { responseType: 'text' }).json('data'));
  const days = [];
  for (let i = 3; days.length < 5; i++) {
    const d = new Date(Date.now() + i * 86400000);
    if (d.getUTCDay() !== 0) days.push(d.toISOString().slice(0, 10));
  }
  return { teachers: list.map((t) => ({ id: t.id, slug: t.slug, subjectId: t.subjects[0].id, duration: t.sessionDurations[0] })), days };
}

/** One distinct simulated client IP per VU (API trusts one proxy hop, as behind nginx). */
function ip() {
  return `10.${(__VU >> 8) & 255}.${__VU & 255}.${(__ITER % 200) + 1}`;
}
const bearer = (token, kind) => ({ headers: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': ip(), 'Content-Type': 'application/json' }, tags: { kind } });
const think = () => sleep(3 + Math.random() * 5);

export default function (data) {
  const role = __VU % 20; // stable persona per VU
  if (role < 11) visitor(data);
  else if (role < 17) student(data);
  else if (role < 19) teacher();
  else admin();
}

function visitor(data) {
  const h = { headers: { 'X-Forwarded-For': ip() }, tags: { kind: 'read' } };
  check(http.get(`${BASE}/subjects`, h), { 'subjects 200': (r) => r.status === 200 });
  think();
  check(http.get(`${BASE}/teachers?subject=${pick(SUBJECTS)}&sort=${pick(SORTS)}&maxPrice=${50000 + Math.floor(Math.random() * 8) * 10000}&page=1&pageSize=12`, h), { 'search 200': (r) => r.status === 200 });
  think();
  const t = pick(data.teachers);
  check(http.get(`${BASE}/teachers/${t.slug}`, h), { 'profile 200': (r) => r.status === 200 });
  const from = new Date();
  const to = new Date(from.getTime() + 7 * 86400000);
  check(http.get(`${BASE}/availability/teachers/${t.id}/slots?from=${from.toISOString()}&to=${to.toISOString()}&durationMinutes=${t.duration}`, h), { 'slots 200': (r) => r.status === 200 });
  think();
}

function student(data) {
  const i = (__VU * 31 + __ITER) % students.length;
  const h = bearer(students[i], 'student');
  if (__ITER % 20 === 0) {
    const n = (__VU * 7 + __ITER) % 3000;
    const res = http.post(`${BASE}/auth/token`, JSON.stringify({ email: `lt-student-${n}@load.test`, password: 'Load-Test-Pass-2026' }), {
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `172.${16 + (n % 16)}.${(n >> 4) & 255}.${(__ITER % 250) + 1}` },
      tags: { kind: 'login' },
    });
    check(res, { 'login 200': (r) => r.status === 200 });
    think();
  }
  check(http.get(`${BASE}/auth/me`, h), { 'me 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/students/me/overview`, h), { 'overview 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/notifications/unread-count`, h), { 'unread 200': (r) => r.status === 200 });
  think();
  check(http.get(`${BASE}/bookings?scope=past&page=1&pageSize=10`, h), { 'history 200': (r) => r.status === 200 });
  think();
  if (__ITER % 15 === 7) {
    const t = pick(data.teachers);
    const start = new Date(`${pick(data.days)}T03:30:00Z`).getTime() + Math.floor(Math.random() * 20) * 30 * 60000;
    const res = http.post(`${BASE}/bookings`, JSON.stringify({ teacherId: t.id, subjectId: t.subjectId, startAt: new Date(start).toISOString(), durationMinutes: 60 }), {
      headers: { ...h.headers, 'Idempotency-Key': `lt-tier-${__VU}-${__ITER}-${Date.now()}` },
      tags: { kind: 'reserve' },
      responseType: 'text',
    });
    check(res, { 'reserve 201/409': (r) => r.status === 201 || r.status === 409 });
    if (res.status === 201) {
      reserved.add(1);
      http.post(`${BASE}/bookings/${res.json('id')}/cancel`, JSON.stringify({ reason: 'load test release' }), bearer(students[i], 'reserve'));
    }
    think();
  } else {
    check(http.get(`${BASE}/students/me/payments?page=1`, h), { 'payments 200': (r) => r.status === 200 });
    think();
  }
}

function teacher() {
  const h = bearer(teachers[__VU % teachers.length], 'teacher');
  check(http.get(`${BASE}/teachers/me/overview`, h), { 'teacher overview 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/notifications/unread-count`, h), { 'unread 200': (r) => r.status === 200 });
  think();
  check(http.get(`${BASE}/teachers/me/earnings`, h), { 'earnings 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/teachers/me/earnings/series`, h), { 'series 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/teachers/me/earnings/ledger?page=1`, h), { 'ledger 200': (r) => r.status === 200 });
  think();
  check(http.get(`${BASE}/bookings?scope=upcoming&page=1&pageSize=10`, h), { 'upcoming 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/teachers/me/application`, h), { 'application 200': (r) => r.status === 200 });
  think();
}

function admin() {
  if (!admins.length) return think();
  const h = bearer(admins[0], 'admin');
  check(http.get(`${BASE}/admin/overview?days=30`, h), { 'admin overview 200': (r) => r.status === 200 });
  think();
  check(http.get(`${BASE}/admin/teachers?approvalStatus=PENDING&stage=submitted&page=1`, h), { 'queue 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/admin/bookings?q=Load&page=1`, h), { 'booking search 200': (r) => r.status === 200 });
  think();
  check(http.get(`${BASE}/admin/finance/summary`, h), { 'finance 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/admin/payouts?status=REQUESTED&page=1`, h), { 'payouts 200': (r) => r.status === 200 });
  think();
}
