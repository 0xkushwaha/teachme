# Deployment

## Topology
- **Ingress / reverse proxy** (nginx, ALB, Cloud Load Balancer, or Kubernetes Ingress) terminating TLS and serving one origin: `/api/*` → backend, everything else → frontend. Reference config: `infrastructure/deployment/nginx.conf`.
- **Backend API**: ≥ 2 stateless replicas of `teachme-backend` (`node dist/server.js`).
- **Worker**: ≥ 1 replica of the same image running `node dist/worker.js` (scale independently; safe to run several — the outbox uses `SKIP LOCKED`, queues are distributed).
- **Frontend**: ≥ 1 replica of `teachme-frontend` (Next.js standalone server). Put a CDN in front for `/_next/static/*` (immutable, 1-year cache).
- **Managed PostgreSQL 16** (RDS, Cloud SQL, Neon, Supabase…) with automated backups and PITR; **managed Redis 7** (ElastiCache, Memorystore, Upstash) with persistence and `maxmemory-policy noeviction` (BullMQ requirement).

Example single-host template: `infrastructure/deployment/docker-compose.prod.yml`.

## Recommended host: Render (Singapore)
`render.production.yaml` defines every production service and env var: frontend, API, worker, PostgreSQL 16 and Redis-compatible Key Value with `noeviction`. (`render.yaml`, the file Render reads by default, is the free testing setup below.)
1. Add a card to the Render workspace (paid plans need one). Then Render → New → **Blueprint** → select this repo and set **Blueprint Path** to `render.production.yaml`. Review the preview; fix any reported spec errors before applying.
2. Fill in the `sync: false` prompts: `APP_URL` = `API_URL` = `CORS_ORIGINS` = `NEXT_PUBLIC_APP_URL` = your site origin, plus the Razorpay, Google and SMTP values. Render generates `JWT_ACCESS_SECRET`, `DATA_ENCRYPTION_KEY` and `METRICS_TOKEN`.
3. Add your custom domain to **teachme-web**, the only origin browsers use. It proxies `/api` to the API over the private network.
4. Point the Razorpay webhook at the **API's own** URL (`https://teachme-api.onrender.com/api/v1/payments/razorpay/webhook`), so the signed body is never proxied. Set the Google redirect URI to `<APP_URL>/api/v1/integrations/google/callback`.
5. Migrations run automatically before each API deploy (`preDeployCommand`).
6. **First admin.** The dev seed refuses to run in production, so create the first administrator from the API service: **teachme-api → Shell**, then
   ```bash
   cd /app && npm run admin:create -- --email owner@yourdomain.com --name "Owner Name"
   ```
   It prompts (hidden, twice) for the password — 10-128 characters with upper case, lower case and a number. Details: [First admin](#first-admin).
7. After the first deploy, sign in as that admin and check that Admin › Audit log shows real client IPs (validates `TRUST_PROXY=2`).

Use paid plans: free instances sleep, and free databases expire. For Indian data residency or larger scale, move to AWS Mumbai (ECS/Fargate, RDS, ElastiCache) using the Docker images below.

### Free tier (client testing only)
`render.yaml` runs the same app on Render's free plans so a client can try it at no cost, with no card on file. It is **not** for real users or real money. Use `render.production.yaml` before launch.

It is the default file deliberately: Render previews `render.yaml` the moment a repository is picked, before the Blueprint Path can be edited, so a paid default would show a "Payment Information Required" dialog first.

What changes compared with `render.production.yaml` (these are Render free-tier rules, not choices):
- **No background worker**: free instances don't exist for workers, so the API runs the queues in-process (`RUN_WORKERS_IN_API=true`).
- **No pre-deploy command**: the API runs `prisma migrate deploy` on every start.
- **Public API URL**: free web services can't receive private-network traffic, so `BACKEND_INTERNAL_URL` is the API's public `https://…onrender.com` address.
- **Email on port 2525**: outbound 25/465/587 are blocked on free instances. Brevo works on `smtp-relay.brevo.com:2525` (log in with an SMTP key, not an API key). Email is **required** even for testing, because students must verify their address before booking.
- **No Shell**: create the first admin from your own computer (below).

What testers will notice:
- Each service sleeps after 15 minutes without traffic, and the first visit after that takes about a minute (the API may need another minute).
- Background jobs (reminder emails, Meet retries) only run while the API is awake.
- 750 free instance hours a month are shared across the workspace.
- **The free database is deleted 30 days after creation** and has no backups. Don't keep anything there you need.

Steps:
1. Render → New → **Blueprint** → select the repo, branch `main`, and leave **Blueprint Path** empty (it defaults to `render.yaml`). The preview should list four services, all on the Free plan, and no worker.
2. Fill in the prompts:
   - `APP_URL` = `API_URL` = `CORS_ORIGINS` = `NEXT_PUBLIC_APP_URL` = the website's URL, e.g. `https://teachme-web.onrender.com`.
   - `BACKEND_INTERNAL_URL` = the API's URL, e.g. `https://teachme-api.onrender.com`.
   - Razorpay **test** keys.
   - SMTP: host, user, SMTP key, `EMAIL_FROM` (a sender verified with the provider) and `SUPPORT_EMAIL`.
   - Google values can stay empty (bookings work, just without Meet links).

   Render may add a suffix to a service name if it's taken. If the URLs differ from what you entered, update the values above and redeploy (the website must be rebuilt after `BACKEND_INTERNAL_URL` changes).
3. Create the first admin from your computer. Copy **teachme-db → Connect → External Database URL**, then:
   ```bash
   cd backend
   DATABASE_URL='<External Database URL>' npm run admin:create:dev -- --email you@yourdomain.com --name "Platform Admin"
   ```
   It prompts for the password without showing it (10+ characters with upper case, lower case and a number). Use an email address you control: password resets and admin alerts go there. Afterwards you can set the database's access list to empty in the Render dashboard.
4. In Razorpay test mode, add the webhook `https://<api>.onrender.com/api/v1/payments/razorpay/webhook` and put its secret in `RAZORPAY_WEBHOOK_SECRET`.
5. Sign in as the admin, add subjects, invite a teacher, then register as a student and book with Razorpay's test cards.
6. Optional sample data, for a demo. It adds subjects, approved toppers, one pending application and students, all sharing the password you choose. It creates no admin, and the accounts use `@example.com`, so their emails go nowhere:
   ```bash
   cd backend
   DATABASE_URL='<External Database URL>' SEED_PASSWORD='<a password you choose>' npm run db:seed:demo
   ```

Self-hosted VM path: copy `infrastructure/deployment/backend.env.example` → `backend.env` and `.env.example` → `.env` on the server (both git-ignored), then use `docker-compose.prod.yml`.
After the first `migrate` run, create the first admin (interactive, so `-it`; see [First admin](#first-admin)):
```bash
docker compose -f docker-compose.prod.yml run --rm -it backend-1 node dist/cli/create-admin.js --email owner@yourdomain.com --name "Owner Name"
```

## First admin
`backend/src/cli/create-admin.ts` is compiled into the backend image as `dist/cli/create-admin.js` (`npm run admin:create` runs it; locally, without a build, use `npm run admin:create:dev`). It uses the image's own `DATABASE_URL`, so run it wherever the API runs: a Render Shell on **teachme-api**, `docker compose run`, or `docker run --rm -it --env-file backend.env $REGISTRY/teachme-backend:$TAG node dist/cli/create-admin.js …`.

| Input | Flag | Env var |
|---|---|---|
| Email | `--email` | `ADMIN_EMAIL` |
| Full name (needed only to create a new account) | `--name` | `ADMIN_NAME` |
| Password | — never a flag, so it stays out of shell history | `ADMIN_PASSWORD`, otherwise a hidden prompt |
| Set a new password on an existing account | `--reset-password` | — |

What it does:
- **No account with that email:** creates an `ADMIN` with the email marked verified, hashed with the API's Argon2id parameters and checked against the same password rule as sign-up.
- **Existing active account:** promotes it to `ADMIN` and keeps its password (it takes effect on that user's next request). Suspended, deactivated or deleted accounts are refused.
- **Already an admin:** does nothing, so it is safe to re-run. With `--reset-password` it sets the new password, clears any lockout and signs out every existing session (also the way to recover a locked-out admin).
- Each change is written to the audit log (`admin.bootstrap_created`, `admin.bootstrap_promoted`, `admin.bootstrap_password_reset`) with no actor and user agent `cli:create-admin`, and is visible in Admin › Audit log.

In a non-interactive context (CI job, one-off task) set `ADMIN_PASSWORD` in that job's environment only; never commit it or add it to a Render Blueprint file. Further admins can then be managed by this admin, or by running the script again.

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

No new environment variables were introduced in session 4. New behaviour is configured through platform settings (Admin › System settings), with safe defaults in code:

| Setting | Default | Meaning |
|---|---|---|
| `features.flags.teacherRegistration` | **`false`** (was `true`) | Open teacher applications without an invitation. Off = invite-only. An existing stored value is kept on upgrade. |
| `onboarding.rules` | `{ invitationTtlHours: 168, requireDocuments: true, maxDocuments: 10 }` | Invitation lifetime; whether at least one document is needed to submit/approve |
| `payouts.rules` | `{ enabled: true, minPayoutMinor: 50000, clearingDays: 3 }` | Manual payout requests: minimum ₹500, 3-day hold after a session before it can be paid out |

**Uploads at the edge:** `infrastructure/deployment/nginx.conf` keeps `client_max_body_size 256k` globally and raises it only for `POST /api/v1/teachers/me/documents` (6 MB) and `/avatar` (3 MB). Any other proxy/CDN in front of the API needs the same exceptions.

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
- Uploaded documents and photos are stored in PostgreSQL (`StoredFile.data`), so they are covered by the same snapshots and PITR — no second storage system to back up. Expect roughly (teachers × documents × ~1 MB); monitor table size (`SELECT pg_size_pretty(pg_total_relation_size('"StoredFile"'))`).
- Redis holds only reconstructable state (queues, caches, rate limits, OAuth state). Losing it is survivable: the outbox, reconciliation job and reminder sweeper repair side effects.

## Scaling notes
- API and worker are stateless; scale horizontally on CPU. Argon2 logins are the most CPU-intensive request type (~tens of ms of CPU each).
- Read-heavy public pages reuse API responses from Next’s 60 s data cache and subjects are cached in Redis; availability is deliberately **not** cached.
- The booking path’s correctness never depends on replica count (database constraints + row locks).
- File storage lives in Postgres so any replica can serve uploads without shared disk or new infrastructure. This is right for the expected volume (a few documents per teacher). If uploads grow (e.g. student assignments, video), move `StoredFile.data` to S3-compatible object storage behind the same `FilesService` and serve via signed URLs.
- See [load-testing.md](load-testing.md) for measured capacity.
