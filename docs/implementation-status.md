# Implementation status

_Last updated: 2026-10-24 (session 2)_

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

## Session 2: frontend (uncommitted at time of writing)

`frontend/` — Next.js 15 (App Router), React 19, Tailwind 4, TanStack Query, React Hook Form + Zod, Radix primitives, Recharts, Luxon. 45 routes; `next build` and ESLint pass.

- **Public:** landing, subjects, subject detail, teacher directory (URL-synced filters), teacher profile with live booking widget, how it works, pricing (live fee config), FAQ, contact/support form, terms, privacy, cancellation policy (live policy values).
- **Auth:** login, register (student/teacher + explicit consent), verify email, forgot/reset password; safe `next=` redirects.
- **Student:** overview, find a teacher, sessions (tabs), session detail (Meet, Google Calendar link, .ics, reschedule, cancel with refund estimate, report issue), checkout (hold countdown, Razorpay Checkout, server verification + polling, conflict/refund states), calendar, notifications, settings (profile, timezone, learning profile, preferences, password, export, delete).
- **Teacher:** overview + setup checklist, calendar (day/week/month), bookings, booking detail (student context, Meet retry), availability (weekly hours, exceptions, rules), profile & subjects (rates in integer paise, admin bounds), Google Calendar connection, notifications, settings (teaching timezone).
- **Admin:** analytics overview (charts), accounts, teacher approvals, subjects/categories, bookings + admin cancel with refund %, payments/discrepancies/refunds (reconcile, resolve, retry), integration health (providers, queues, outbox, jobs retry, webhooks), notification templates (edit + sandboxed preview), audit log, settings & feature flags, support tickets.
- Backend additions: `GET /api/v1/platform/config` (public fees/policies/banner).

Verified in a browser against the running stack: landing, login redirect, slot selection, reservation → checkout, honest "Razorpay not configured" error, slot release, teacher dashboard/availability/integrations, admin overview/integrations, 375px layout (no horizontal scroll).

Bugs found and fixed in session 2: honorific greetings ("Welcome, Dr."); empty name in calendar-reconnect email; backend never loaded `.env` explicitly; `npm start`/compose pointed at `dist/src/*.js` (build emits `dist/*.js`); late reminders could send a "starts in 24 hours" email an hour before a session (now superseded by the nearer reminder and worded from real time remaining); day tabs lacked accessible names; reveal animations depended on IntersectionObserver/JS (now CSS-only); tab bars clipped on phones.

Tests after session 2: backend unit **68/68**, integration **47/47** (3 consecutive runs).

## Not started yet (next sessions)
1. Per-page `<title>` metadata for client dashboard pages (currently the site default).
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
