/**
 * Where the Next.js server reaches the API. Accepts a full URL or a bare `host:port`
 * (Render's private-network `hostport`), in which case plain HTTP on the private network is used.
 */
export function backendInternalUrl(raw = process.env.BACKEND_INTERNAL_URL) {
  const value = (raw ?? 'http://localhost:4000').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(value) ? value : `http://${value}`;
}
