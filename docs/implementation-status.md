# Implementation status

_Last updated: 2026-11-01 (session 4)_

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

## Session 2: frontend

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

## Session 3: E2E, load testing, delivery

- **E2E (Playwright, `frontend/tests/e2e`)**: isolated stack (`backend/test/e2e/e2e-server.ts` on :4100 with `teachme_e2e` DB, Next on :3100). Razorpay/Google HTTP faked (HMAC real), email via real SMTP → Mailpit. Covers all 11 journey steps + public smoke on desktop and mobile. **12/12 passed** (4 passing runs during the session; 1 on the final code after the zod 4 upgrade and rendering change).
- **Load tests (k6, `loadtest/`, `scripts/run-loadtest.sh`)**: results in [load-testing.md](load-testing.md) — 0 errors; p95 reads 9 ms, dashboards 13 ms, logins 42 ms, reservations 25 ms, webhooks 17 ms; 300-way same-slot race → exactly 1 reservation; 1,000 emails delivered in 2.1 s.
- **Delivery**: backend/frontend Dockerfiles (multi-stage, non-root, tini, health checks — both built and booted locally), nginx ingress, production compose with migrate job, Prometheus config + alert rules, GitHub Actions CI (lint, types, unit, integration, migration drift check, E2E, builds, audit, Docker builds), Dependabot.
- **Docs**: architecture, api, database, security (incl. endpoint authorization review), integrations, deployment (incl. backup/restore), operations runbook, load testing, README; `docs/openapi.json` exported (85 paths).

Bugs found and fixed in session 3: `/auth/refresh` without a session crashed with a double response; `.ics` export didn’t escape `;` (corrupt calendar files); `/metrics` was unreachable (moved under URI versioning); backend Docker build OOM (switched `googleapis` → `@googleapis/calendar`); argon2 needed a build toolchain in the image; public pages were prerendered at build time without the API. Dependency audit: 8 backend / 3 frontend findings → **0** (zod 3 → 4, `@hookform/resolvers` 5, overrides for multer, deepmerge-ts, js-yaml, postcss).

Final results (session 3): backend unit **69/69**, integration **49/49**, E2E **12/12**; lint, typecheck and production builds clean for both apps; `npm audit --omit=dev` 0 vulnerabilities.

## Session 4: three-role upgrade (1 Nov 2026)

Audit first ([upgrade-audit.md](upgrade-audit.md)), then extended the existing app — nothing rebuilt, no data reset. One additive migration (`20261101120000_onboarding_earnings_payouts`).

- **Teacher invitations & onboarding:** admin invite / resend (token rotation) / revoke / expiry; hashed single-use tokens claimed with compare-and-set; acceptance creates a verified TEACHER account; open teacher sign-up off by default. Application checklist → document upload (content-sniffed, ≤ 5 MB) → submit → admin review (document verify/reject, approve, reject **with reason**) → resubmit. Photo upload replaces external avatar URLs.
- **Teacher dashboard:** Earnings & payouts page (available / clearing / pending-from-upcoming / this month / lifetime, 12-week and 12-month charts, cancellation rate, ledger, payout history, request/cancel payout); Application & documents page; "Mark completed" after a session ends.
- **Earnings integrity:** append-only ledger enforced by a DB trigger, written in the completion transaction (one per booking via partial unique index); pro-rata on refunds; teacher overview's 30-day figure now comes from the ledger (it previously counted future, unpaid sessions).
- **Payouts (manual):** one open request per teacher (advisory lock + partial unique index), admin approve → mark paid with bank reference / reject (releases entries), emails at each step. No payment provider is called.
- **Admin:** invitations tab, review queue split into *awaiting review* / *still applying*, teacher detail (documents, profile, stats, recent bookings, ledger, adjustments), finance reports (collected, refunds, fees, tax, earnings accrued, payouts, outstanding balance, top teachers, CSV with formula-injection-safe cells), payout queue, announcements, account detail with activity + removal by re-typing the email, booking search.
- **Student:** Payments & receipts (history incl. refunds and failures, printable receipt).
- **Emails:** `teacher_invitation`, `teacher_welcome`, `teacher_application_submitted`, `admin_teacher_application`, `payout_update`; `teacher_approval` now carries the rejection reason.
- **Ops:** nginx allows larger bodies only on the two upload routes; settings `onboarding.rules`, `payouts.rules`.

Bugs found and fixed this session: teacher overview over-reported earnings (included unearned future sessions); production nginx would have rejected every upload (256 KB body limit); integration suite could hit per-IP route limits from a previous run (now simulates distinct clients behind one trusted proxy hop, as in production).

Tests after session 4: backend unit **79/79** (10 new), integration **65/65** (16 new: invitations incl. 6-way acceptance race, uploads/polyglots/oversize, application approve/reject/resubmit, document access control, avatar serving, completion race → exactly one earning, ledger immutability, 4-way payout race → exactly one, payout lifecycle, receipts, finance CSV, account removal, announcements); lint/typecheck/build clean for both apps; E2E **16/16** (4 new: admin invites from the UI → email via Mailpit → teacher accepts → lands on application → link cannot be reused → teacher refused by admin API). Verified live in the browser against the running stack with real SMTP → Mailpit (invitation, welcome, application received, admin alert, approval). `docs/openapi.json` re-exported (85 → 122 paths). After the PR opened, newly published advisories failed CI's backend audit: `follow-redirects` 1.16.1 → 1.16.2 (high) via lockfile, and a scoped `glob` override for the unused `gaxios › rimraf` path (moderate); `npm audit --omit=dev` back to **0 vulnerabilities**.

Load test (stepped 100/500/1,000/2,000 concurrent users, one laptop, one API process): **0 errors in 148,104 requests** at every tier; p95 30 / 21 / 144 / 356 ms; p99 at 1,000–2,000 users 0.7–0.9 s and reservation p95 1.6–2.0 s — PostgreSQL CPU is the bottleneck. Supports ~500 concurrent users comfortably on this hardware; 2,000 is *not* demonstrated at production quality. Details and next steps: [load-testing.md](load-testing.md).

## Not started yet (next sessions)
0. From session 4: staging load test on dedicated Postgres + 2–3 API replicas (the 2,000-user target); malware scanning for uploaded documents; real Razorpay test keys to exercise earnings from real captured payments end to end; a payout bank-details form (teachers currently share bank details with support out of band).
1. ~~Per-page `<title>` metadata for client dashboard pages~~ — done 4 Nov 2026: `DashboardShell` names the tab after the active section (e.g. "Finance reports · TeachMe").
2. Admin MFA (TOTP/SSO); legal review of terms/privacy/refund pages.
3. Load test on production-like staging (2+ API replicas, separate load generator).
4. Live verification with real Razorpay test keys and a Google OAuth client (code paths covered by integration/E2E tests with provider fakes only).

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
