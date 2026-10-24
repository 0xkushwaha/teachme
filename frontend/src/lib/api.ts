/**
 * Browser API client. All calls go to the same-origin /api/v1 (cookies are first-party and
 * HttpOnly; JavaScript never sees auth tokens). Unsafe requests carry the CSRF token from the
 * readable tm_csrf cookie. A 401 triggers one refresh attempt, then the request is retried.
 */
export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  /** Field-level messages from class-validator, if any. */
  get fieldMessages(): string[] {
    return Array.isArray(this.details) ? (this.details as string[]) : [];
  }
}

function readCookie(name: string) {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.split('=')[1];
}

let csrfPromise: Promise<void> | null = null;
async function ensureCsrf() {
  if (readCookie('tm_csrf')) return;
  csrfPromise ??= fetch(`${API_BASE}/auth/csrf`, { credentials: 'include' }).then(() => undefined).finally(() => (csrfPromise = null));
  await csrfPromise;
}

let refreshPromise: Promise<boolean> | null = null;
async function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    await ensureCsrf();
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': decodeURIComponent(readCookie('tm_csrf') ?? '') },
    });
    return res.ok;
  })().finally(() => (refreshPromise = null));
  return refreshPromise;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  idempotencyKey?: string;
  /** Skip the automatic refresh-and-retry (used by auth endpoints themselves). */
  noRefresh?: boolean;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const url = new URL(`${API_BASE}${path}`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));

  const send = async () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') {
      await ensureCsrf();
      headers['x-csrf-token'] = decodeURIComponent(readCookie('tm_csrf') ?? '');
    }
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    return fetch(url.pathname + url.search, {
      method,
      credentials: 'include',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  };

  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  if (res.status === 401 && !opts.noRefresh && (await refreshSession())) res = await send();

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return json as T;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function newIdempotencyKey(prefix = 'web') {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rnd}`;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.') {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_FAILED' && err.fieldMessages.length) return err.fieldMessages[0];
    return err.message;
  }
  return fallback;
}
