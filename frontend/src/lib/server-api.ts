import 'server-only';

/** Server-side fetch for public, non-personalised data (SSR/ISR). Never forwards user cookies. */
const BASE = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

export async function serverGet<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}/api/v1${path}`, { next: { revalidate }, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
