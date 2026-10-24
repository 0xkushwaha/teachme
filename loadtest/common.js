// Shared helpers for k6 scenarios. Run via scripts/run-loadtest.sh (k6 in Docker).
import { SharedArray } from 'k6/data';

export const BASE = __ENV.BASE_URL || 'http://host.docker.internal:4200/api/v1';
export const tokens = new SharedArray('tokens', () => JSON.parse(open('/results/tokens.json')));

/** Simulated client IP (API runs with TRUST_PROXY=1, as behind a load balancer). */
export function clientIp() {
  return `10.${(__VU >> 8) & 255}.${__VU & 255}.${(__ITER % 250) + 1}`;
}

export function authHeaders(i) {
  return { Authorization: `Bearer ${tokens[i % tokens.length]}`, 'X-Forwarded-For': clientIp(), 'Content-Type': 'application/json' };
}

export function anonHeaders() {
  return { 'X-Forwarded-For': clientIp() };
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
