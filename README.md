# TeachMe

A student–teacher booking platform: students discover verified teachers by subject, book live sessions in the teacher’s real availability, pay through Razorpay, meet on Google Meet, and get automatic reminders. Teachers manage hours, pricing and their calendar; administrators run the platform from an operational dashboard.

```
frontend/        Next.js 15 app (UI only; talks to the API over /api/v1)
backend/         NestJS API + background worker, Prisma/PostgreSQL, BullMQ/Redis
infrastructure/  docker-compose (local), deployment (nginx, prod compose), monitoring (Prometheus + alerts)
loadtest/        k6 scenarios          scripts/  run-loadtest.sh
docs/            architecture · api · database · security · deployment · integrations · operations-runbook · load-testing · implementation-status
```

## Stack
| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4, Radix primitives, TanStack Query 5, React Hook Form + Zod, Motion, Recharts, Luxon, Playwright |
| Backend | Node 20, NestJS 11, TypeScript, Prisma 6, PostgreSQL 16, Redis 7, BullMQ 5, pino, prom-client, Jest |
| Integrations | Razorpay (official SDK), Google Calendar API v3 + Meet conferences (`@googleapis/calendar`), SMTP (nodemailer — SES/Postmark/SendGrid/Resend/Mailpit) |
| Ops | Docker, nginx, GitHub Actions, Prometheus alert rules, k6 |

Key design points (details in [docs/architecture.md](docs/architecture.md)):
- **No double bookings, by construction:** PostgreSQL exclusion constraints over time ranges (including teacher buffer), short-lived checkout holds, compare-and-set state transitions, idempotency keys.
- **A payment confirms a booking only after server-side verification** (signature + fetch from Razorpay + amount/currency/order checks). Webhooks, the checkout callback and a reconciler share one idempotent settlement path; late payments for a lost slot are refunded automatically.
- **Reliable side effects:** transactional outbox → BullMQ jobs with retries, dedupe keys, durable reminders with a repair sweeper, and an ops view to retry anything that failed.

## Local development

Prerequisites: Node ≥ 20.11, Docker.

```bash
# 1. Infrastructure: PostgreSQL, Redis, Mailpit (SMTP sink, UI at http://localhost:8025)
docker compose -f infrastructure/docker-compose.yml up -d postgres redis mailpit

# 2. Backend
cd backend
npm ci
cp .env.example .env          # then set JWT_ACCESS_SECRET and DATA_ENCRYPTION_KEY:
                              #   openssl rand -base64 48   /   openssl rand -base64 32
npx prisma migrate deploy
npm run db:seed               # subjects, 12 teachers, students, an admin
RUN_WORKERS_IN_API=true npm run dev     # API on http://localhost:4000 (docs at /api/docs)
#   …or run the worker separately: npm run dev:worker

# 3. Frontend (new terminal)
cd frontend
npm ci
cp .env.example .env.local
npm run dev                   # http://localhost:3000
```

### Seed accounts (development only)
All seeded accounts share the password defined in `backend/prisma/seed.ts` (`SEED_PASSWORD` env var overrides it).

| Role | Email |
|---|---|
| Admin | `admin@teachme.dev` |
| Students | `aanya.student@teachme.dev`, `dev.student@teachme.dev`, `maya.student@teachme.dev` |
| Teachers | `meera.iyer@teachme.dev`, `arjun.mehta@teachme.dev`, … (see seed) |
| Teacher awaiting approval | `pending.teacher@teachme.dev` |

Without Razorpay/Google credentials the app runs fully, but **Pay** reports that payments aren’t configured and Meet links show “not available” — nothing is faked. Configure them with [docs/integrations.md](docs/integrations.md).

### Environment files
- `backend/.env.example` — every backend variable with placeholders (secrets live **only** here).
- `frontend/.env.example` — `NEXT_PUBLIC_APP_URL` (public) and `BACKEND_INTERNAL_URL` (server-side). No secrets.
- `.env`/`.env.local` files are git-ignored.

## Tests
```bash
# Backend (needs the docker compose stack)
cd backend
npm run lint && npm run typecheck
npm test                     # unit: slot engine/timezones/DST, money, state machine, policies, signatures, authz, templates
npm run test:integration     # real Postgres + Redis: concurrency, payments/webhooks, refunds, calendar/Meet, notifications, RBAC
                             # (uses its own teachme_test database; provider HTTP calls are faked, HMAC checks are real)
# Frontend
cd frontend
npm run lint && npm run typecheck && npm run build
npm run test:e2e             # Playwright: starts an isolated stack (:4100/:3100, teachme_e2e DB, real SMTP→Mailpit)
```
Latest results are recorded in [docs/implementation-status.md](docs/implementation-status.md); load-test results in [docs/load-testing.md](docs/load-testing.md).

## Load testing
```bash
cd backend && npm run build && npx ts-node --transpile-only scripts/loadtest-seed.ts   # 3,000 students, ~150 teachers, ~15k bookings
cd .. && ./scripts/run-loadtest.sh            # k6 (Docker) against a production build on :4200
```

## Deployment
Docker images (`backend/Dockerfile`, `frontend/Dockerfile`), nginx ingress, production compose template, migrations, health checks, monitoring and backup/restore: [docs/deployment.md](docs/deployment.md). Incident procedures: [docs/operations-runbook.md](docs/operations-runbook.md). Security model and endpoint authorization review: [docs/security.md](docs/security.md).
