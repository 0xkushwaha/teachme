# Deployment

## Topology
- **Ingress / reverse proxy** (nginx, ALB, Cloud Load Balancer, or Kubernetes Ingress) terminating TLS and serving one origin: `/api/*` → backend, everything else → frontend. Reference config: `infrastructure/deployment/nginx.conf`.
- **Backend API**: ≥ 2 stateless replicas of `teachme-backend` (`node dist/server.js`).
- **Worker**: ≥ 1 replica of the same image running `node dist/worker.js` (scale independently; safe to run several — the outbox uses `SKIP LOCKED`, queues are distributed).
- **Frontend**: ≥ 1 replica of `teachme-frontend` (Next.js standalone server). Put a CDN in front for `/_next/static/*` (immutable, 1-year cache).
- **Managed PostgreSQL 16** (RDS, Cloud SQL, Neon, Supabase…) with automated backups and PITR; **managed Redis 7** (ElastiCache, Memorystore, Upstash) with persistence and `maxmemory-policy noeviction` (BullMQ requirement).

Example single-host template: `infrastructure/deployment/docker-compose.prod.yml`.

## Recommended host: Render (Singapore)
`render.yaml` defines every service and env var: frontend, API, worker, PostgreSQL 16 and Redis-compatible Key Value with `noeviction`.
1. Render → New → **Blueprint** → select this repo. Review the preview; fix any reported spec errors before applying.
2. Fill in the `sync: false` prompts: `APP_URL` = `API_URL` = `CORS_ORIGINS` = `NEXT_PUBLIC_APP_URL` = your site origin, plus the Razorpay, Google and SMTP values. Render generates `JWT_ACCESS_SECRET`, `DATA_ENCRYPTION_KEY` and `METRICS_TOKEN`.
3. Add your custom domain to **teachme-web**, the only origin browsers use. It proxies `/api` to the API over the private network.
4. Point the Razorpay webhook at the **API's own** URL (`https://teachme-api.onrender.com/api/v1/payments/razorpay/webhook`), so the signed body is never proxied. Set the Google redirect URI to `<APP_URL>/api/v1/integrations/google/callback`.
5. Migrations run automatically before each API deploy (`preDeployCommand`).
6. After the first deploy, sign in and check that Admin › Audit log shows real client IPs (validates `TRUST_PROXY=2`).

Use paid plans: free instances sleep, and free databases expire. For Indian data residency or larger scale, move to AWS Mumbai (ECS/Fargate, RDS, ElastiCache) using the Docker images below.

Self-hosted VM path: copy `infrastructure/deployment/backend.env.example` → `backend.env` and `.env.example` → `.env` on the server (both git-ignored), then use `docker-compose.prod.yml`.

## Build images
```bash
docker build -t $REGISTRY/teachme-backend:$TAG backend
docker build -t $REGISTRY/teachme-frontend:$TAG \
  --build-arg NEXT_PUBLIC_APP_URL=https://teachme.example \
  --build-arg BACKEND_INTERNAL_URL=http://backend:4000 \
  frontend
docker push $REGISTRY/teachme-backend:$TAG && docker push $REGISTRY/teachme-frontend:$TAG
```
Both images run as the non-root `node` user, use `tini` as PID 1 for signal handling and declare health checks.

## Configuration
Backend environment (see `backend/.env.example` for every variable):

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL`, `API_URL` | `https://teachme.example` (same origin) |
| `CORS_ORIGINS` | `https://teachme.example` |
| `DATABASE_URL` | managed Postgres URL with `sslmode=require&connection_limit=20` |
| `REDIS_URL` | `rediss://…` |
| `JWT_ACCESS_SECRET` | ≥ 48 random bytes |
| `DATA_ENCRYPTION_KEY` | 32 random bytes, base64 |
| `COOKIE_SECURE` | `true` (required) |
| `COOKIE_DOMAIN` | empty for host-only, or `.teachme.example` |
| `TRUST_PROXY` | number of proxy hops in front of the API (usually `1`) |
| `METRICS_TOKEN` | random string (required) |
| `RAZORPAY_*`, `GOOGLE_*`, `SMTP_*`, `EMAIL_FROM` | see [integrations.md](integrations.md) |

Frontend: `NEXT_PUBLIC_APP_URL` (build arg) and `BACKEND_INTERNAL_URL` (build arg for the rewrite fallback and server-side public fetches). Nothing secret belongs in the frontend.

The API validates configuration at boot and refuses to start on invalid values.

## Release procedure
1. CI green (lint, types, unit, integration, E2E, builds, audit).
2. Run migrations once: `docker run --rm --env-file backend.env $REGISTRY/teachme-backend:$TAG npx prisma migrate deploy` (or `docker compose --profile migrate run --rm migrate`). Migrations are additive/backward-compatible so old replicas keep working during the roll.
3. Roll the worker, then the API replicas (one at a time; readiness gate `GET /api/v1/health/ready`), then the frontend.
4. Smoke test: landing page, teacher profile slots, login, Admin › Integration health shows providers configured and queues draining.
5. Rollback: redeploy the previous image tags. Do not roll back migrations unless a migration-specific down script has been prepared and tested.

Connection budgeting: `replicas × connection_limit` (API) + `workers × connection_limit` must stay below the database’s `max_connections` minus headroom. For many replicas, front Postgres with PgBouncer in transaction mode (Prisma: add `pgbouncer=true`).

## Health checks and graceful shutdown
- Liveness `GET /api/v1/health/live`; readiness `GET /api/v1/health/ready` (checks DB and Redis). Point load balancers at readiness.
- On SIGTERM the API stops accepting connections and finishes in-flight requests; the worker stops taking jobs and completes active ones. Give containers ≥ 30 s grace. Keep-alive timeout (65 s) exceeds typical LB idle timeouts to avoid 502s.

## Monitoring
- Prometheus scrapes each API replica’s `/metrics` (Bearer `METRICS_TOKEN`) — config: `infrastructure/monitoring/prometheus.yml`; alert rules: `infrastructure/monitoring/alerts.yml` (5xx rate, p95 latency, outbox backlog, queue backlog, dying jobs, payment anomalies, event-loop lag).
- Metrics: `http_request_duration_seconds{method,route,status}`, `booking_events_total`, `payment_events_total`, `job_events_total`, `queue_waiting_jobs`, `outbox_pending_events`, plus Node process/runtime metrics.
- Logs: structured JSON (pino) with `requestId`, secrets/PII redacted. Ship stdout to your log platform; correlate with the `X-Request-Id` response header and the `requestId` in error bodies.
- Error reporting: route `level>=50` logs to your alerting tool (Sentry via a pino transport, Datadog, CloudWatch alarms).
- Business health: Admin › Integration health (providers, queues, outbox lag, failed jobs, unprocessed webhooks) and Admin › Payments › Discrepancies.

## Backups and restore
- Enable automated daily snapshots with **point-in-time recovery** (≥ 7 days; 30 recommended) on the managed database, plus a weekly logical dump to separate storage:
  ```bash
  pg_dump --format=custom --no-owner "$DATABASE_URL" > teachme-$(date +%F).dump
  ```
- Restore drill (do this quarterly into a scratch instance):
  ```bash
  createdb teachme_restore
  pg_restore --no-owner --dbname "postgresql://…/teachme_restore" teachme-YYYY-MM-DD.dump
  DATABASE_URL=postgresql://…/teachme_restore npx prisma migrate status   # must report "up to date"
  ```
  Then point a staging API at it and confirm login, a teacher profile and Admin › Payments load.
- After a PITR restore, run payment reconciliation (Admin › Payments › Reconcile, or wait for the 10-minute job) so any payments captured after the restore point are re-settled from Razorpay, and re-run the reminder sweeper (automatic).
- Redis holds only reconstructable state (queues, caches, rate limits, OAuth state). Losing it is survivable: the outbox, reconciliation job and reminder sweeper repair side effects.

## Scaling notes
- API and worker are stateless; scale horizontally on CPU. Argon2 logins are the most CPU-intensive request type (~tens of ms of CPU each).
- Read-heavy public pages reuse API responses from Next’s 60 s data cache and subjects are cached in Redis; availability is deliberately **not** cached.
- The booking path’s correctness never depends on replica count (database constraints + row locks).
- See [load-testing.md](load-testing.md) for measured capacity.
