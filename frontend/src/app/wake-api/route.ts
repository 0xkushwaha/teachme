import { backendInternalUrl } from '@/lib/backend-url';

export const dynamic = 'force-dynamic';

/**
 * Wakes a sleeping API on Render's free tier. Requests proxied through the /api rewrite get a 502
 * and don't wake it, but a plain request from this server to the API's public URL does.
 */
export async function GET() {
  await fetch(`${backendInternalUrl()}/api/v1/health/live`, { cache: 'no-store', signal: AbortSignal.timeout(90_000) }).catch(() => undefined);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
