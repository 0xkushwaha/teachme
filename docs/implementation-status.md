# Implementation status

_Last updated: 2026-10-24 (session 1)_

## Done and verified

| Area | State | Evidence |
|---|---|---|
| Local infra | `infrastructure/docker-compose.yml`: Postgres 16, Redis 7, Mailpit (SMTP sink). App services under the `app` profile. | Running locally |
| Database | Prisma schema + 1 migration. Hand-written SQL adds `btree_gist` **exclusion constraints** (teacher overlap incl. buffer; student overlap) and CHECK constraints (money totals, time ranges, limits). | `\d "Booking"` shows constraints; integration tests |
| Auth | Argon2id, 15-min JWT access cookie + rotating refresh tokens with reuse detection, CSRF double-submit + Origin check, lockout after 5 failures, email verification, password reset, Bearer tokens for API clients (`POST /auth/token`). | Unit + integration tests, smoke test |
| Booking engine | Pure slot engine (timezones/DST, exceptions, buffer, notice, advance window), PENDING_PAYMENT holds with inline stale-hold expiry, state machine with compare-and-set transitions, cancel/refund policy, reschedule policy, idempotency keys. | 25-way concurrent reservation test: exactly 1 wins |
| Payments | Razorpay SDK adapter; orders, checkout signature verification (constant-time HMAC), payment fetch/capture, webhook verification on raw body, idempotent settlement shared by verify/webhook/reconciler, late-capture → automatic full refund, refunds with adoption on retry, discrepancy flags, reconciliation job. | Integration tests (fake gateway at the HTTP boundary; HMAC is real) |
| Google Calendar / Meet | OAuth with single-use state bound to Redis + cookie, AES-256-GCM encrypted refresh tokens, deterministic event ids, `conferenceData.createRequest`, async Meet polling, revoked-access handling, safe retry with new request id. | Integration tests with fake calendar gateway |
| Notifications | Transactional outbox (`FOR UPDATE SKIP LOCKED`), BullMQ queues, email via SMTP adapter, HTML + text templates (admin-editable, escaped), in-app notifications, preferences, durable reminders + sweeper, dedupe keys. | Integration tests; real email delivered to Mailpit |
| Admin API | Users, teachers approval, subjects/categories, bookings, payments/refunds, integration health, jobs retry, webhooks, templates, audit logs, settings/feature flags, support tickets. All `@Roles('ADMIN')`, audited. | RBAC tests |
| Ops | Health (`/api/v1/health/live`, `/ready`), Prometheus `/metrics`, pino logs with redaction, Redis rate limiting, graceful shutdown, separate `worker.ts`. | Smoke test |

### Test results (session 1)
- Backend unit: **65 / 65 passed**
- Backend integration (real Postgres + Redis, provider fakes): **47 / 47 passed, 5 consecutive runs**
- `tsc --noEmit`: clean

### Fixed this session
- **Outbox clock skew (real bug):** outbox rows were timestamped by the Node process but eligibility was compared with Postgres `now()`. A few ms of clock jitter made fresh events invisible to an immediate drain (flaky test; in production, multi-server clock skew). `OutboxService.publish` now inserts with database-side `now()`.
- Integration tests no longer require a wiped DB (Prisma correctly refuses `migrate reset` from an AI agent); setup uses `migrate deploy` on a dedicated `*_test` database and tests use unique fixtures.

## Not started yet (next sessions)
1. **Frontend** (`frontend/`, Next.js 15 + Tailwind + TanStack Query + RHF/Zod): all public, auth, student, teacher, admin pages; Razorpay Checkout integration.
2. **E2E** (Playwright) including stubbed Checkout via a test-only backend entry point.
3. **Load tests** (k6) and documented results.
4. Dockerfiles, CI workflow, nginx/ingress config, monitoring config.
5. Docs: architecture, api (OpenAPI export), database, security, deployment, integrations, runbook, README.
6. ESLint run + fixes; `npm audit` review.

## Credentials still required (external)
- Razorpay test keys + webhook secret (dashboard → Settings → API keys / Webhooks)
- Google Cloud OAuth client (Calendar API enabled, consent screen, redirect URI)
- Production SMTP provider credentials

## How to resume
```bash
docker compose -f infrastructure/docker-compose.yml up -d postgres redis mailpit
cd backend && npm ci && npx prisma migrate deploy && npm run db:seed
npm test && npm run test:integration
```
