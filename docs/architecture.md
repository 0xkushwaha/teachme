# Architecture

TeachMe is a **modular monolith** with a separate **worker process**, plus a **Next.js frontend**. Each is built, tested and deployed independently from its own top-level folder.

```
                 ┌──────────────── browser ────────────────┐
                 │  Next.js UI  ·  Razorpay Checkout (iframe) │
                 └───────────────┬──────────────────────────┘
                                 │ HTTPS (same origin: /, /api)
                          ┌──────▼──────┐
                          │ nginx/ingress│  TLS, edge rate limit, /metrics blocked
                          └──┬────────┬──┘
                 /           │        │ /api/v1
        ┌────────▼───────┐   │   ┌────▼───────────────────┐   ×N stateless replicas
        │ frontend (Next)│   │   │ backend API (NestJS)   │
        │ SSR public data│   │   │ auth · RBAC · booking  │
        └────────────────┘   │   │ payments · admin       │
                             │   └───┬───────────┬────────┘
                             │       │ Prisma    │ ioredis / BullMQ
                       ┌─────▼───────▼──┐   ┌────▼─────┐
                       │  PostgreSQL 16 │   │ Redis 7  │  queues, rate limits, caches,
                       │ (source of     │   │          │  OAuth state, settings cache
                       │  truth)        │   └────▲─────┘
                       └─────▲──────────┘        │
                             │            ┌──────┴──────────────┐   ×M replicas
                             └────────────┤ worker (same image) │  outbox relay, email,
                                          │ node dist/worker.js │  calendar/Meet, refunds,
                                          └──┬──────┬──────┬────┘  reminders, maintenance
                                  Razorpay API   Google Calendar API   SMTP provider
```

## Why a modular monolith
The domain (bookings ↔ payments ↔ calendar ↔ notifications) is tightly transactional. One deployable with clear module boundaries keeps the critical invariants inside **one database transaction**, while the expensive or unreliable work (email, Google, refunds) runs asynchronously in the worker. Both scale horizontally; nothing is held in process memory except short-lived caches.

## Backend modules (`backend/src/modules`)
| Module | Responsibility |
|---|---|
| `auth` | Registration, login, rotating refresh tokens, email verification, password reset, CSRF cookie |
| `users`, `students` | Self profile, data export, account deletion, student learning profile |
| `teachers` | Public search (single SQL query, server-side filters), public profile, price quote, teacher self-service |
| `subjects` | Catalogue (Redis-cached 60 s, public data only) |
| `availability` | Pure **slot engine** (`slot-engine.ts`) + weekly hours, exceptions, booking rules |
| `bookings` | Reservation, **state machine**, cancel/reschedule policies, listings, `.ics` |
| `payments` | Razorpay orders, signature verification, webhook ingestion, settlement, refunds, reconciliation |
| `calendar`, `meetings` | Google OAuth connection, event sync, Meet conference lifecycle, retries |
| `notifications` | Templates, preferences, in-app inbox, email delivery, reminder scheduling |
| `admin`, `analytics`, `support` | Operations dashboards and actions (all audited) |

Cross-cutting: `common/` (guards, errors, idempotency interceptor), `services/` (Redis, settings, audit, outbox, metrics), `integrations/` (provider adapters behind interfaces), `jobs/` (queues, outbox dispatcher, processors).

## Request pipeline
`RequestContextMiddleware` (request id, latency metric) → `AuthGuard` (cookie or Bearer → re-reads user status/role from DB) → `CsrfGuard` (Origin check + double-submit token for cookie clients) → `AppThrottlerGuard` (Redis, per user or IP) → `IdempotencyInterceptor` (routes marked `@Idempotent`) → `ValidationPipe` (whitelist + forbid unknown fields) → controller → `AllExceptionsFilter` (uniform error envelope, no stack traces).

## Booking lifecycle and state machine
```
PENDING_PAYMENT ──payment verified──▶ CONFIRMED ──session ended──▶ COMPLETED
   │  │  │                               │
   │  │  └─hold expired─▶ EXPIRED ───────┤ late capture & slot still free → CONFIRMED
   │  └─hold expired, attempt failed─▶ PAYMENT_FAILED ─▶ CONFIRMED (late capture)
   └─student releases─▶ CANCELLED       └─cancel (policy refund)─▶ CANCELLED
```
Every transition goes through `BookingsService.transition()`: it validates against `BOOKING_TRANSITIONS`, performs a **compare-and-set** (`UPDATE … WHERE status = <expected>`), and writes a `BookingStatusHistory` row in the same transaction. Rescheduling keeps the status `CONFIRMED`, bumps `version`, and is recorded in history.

1. Student picks teacher, subject, length and a slot computed by the slot engine in the teacher’s timezone (DST-aware) and shown in the student’s timezone.
2. `POST /bookings` (Idempotency-Key required) re-validates everything server-side: teacher approved & active, teaches subject, duration allowed, slot inside working hours/exceptions/buffer/notice/advance window, price computed from server data.
3. In one transaction: expire stale holds for that teacher/student, insert `PENDING_PAYMENT` with `holdExpiresAt` (default 10 min). The **exclusion constraint** rejects overlaps atomically → `409 SLOT_UNAVAILABLE`.
4. `POST /payments/orders` creates (or reuses) the Razorpay order for the server-computed amount.
5. Checkout returns ids + signature; `POST /payments/razorpay/verify` checks the HMAC, **fetches the payment from Razorpay**, validates order/amount/currency, captures if only authorized, then settles.
6. Settlement (shared by verify, webhook and reconciler) locks the payment row, marks it captured, re-checks the booking is still confirmable and transitions to `CONFIRMED` — again guarded by the exclusion constraint. If the slot was lost (late payment) or the teacher became unavailable, the payment is recorded and a **full refund** is queued automatically.
7. The same transaction writes a `booking.confirmed` **outbox event**. The worker turns it into notifications, a calendar-sync job (event + Meet), and delayed reminder jobs.

## Reliability patterns
- **Transactional outbox** (`OutboxEvent`): side effects are published only if the state change commits; the dispatcher claims rows with `FOR UPDATE SKIP LOCKED`, so any number of workers can run. Timestamps use the DB clock.
- **Idempotency everywhere it matters**: idempotency keys on booking/order/reschedule, unique `providerOrderId`/`providerPaymentId`/`providerRefundId`, unique `(provider, eventId)` for webhooks, unique notification `dedupeKey`, BullMQ `jobId`s, deterministic Google event ids, unique conference request ids.
- **Monotonic payment state**: a late `payment.failed` never downgrades a capture.
- **Reconciliation** (every 10 min): settles payments whose callback and webhook were both lost; polls in-flight refunds.
- **Durable reminders**: delayed BullMQ jobs keyed by start time (stale after reschedule) plus a 5-minute sweeper that repairs reminders lost to Redis/worker outages, superseding stale offsets.
- **Bounded retries** with exponential backoff per queue; permanent errors (`UnrecoverableError`) stop immediately; every tracked job is visible and retryable in Admin › Integration health.
- **Graceful shutdown**: SIGTERM stops HTTP intake / job intake and drains in-flight work.

## Frontend (`frontend/src`)
- `app/` — routes (route groups for public and auth pages; `student/`, `teacher/`, `admin/` dashboards).
- `components/ui` — accessible primitives (Radix dialog/tabs/switch/dropdown), `layouts/` — site chrome and role-aware dashboard shell.
- `features/` — booking (slot picker, widget, checkout, detail), teachers, calendar, account, admin, support.
- `services/` — typed API clients; `lib/api.ts` handles CSRF, single-flight refresh, idempotency keys and error normalisation.
- Public catalogue pages are server-rendered per request (never prerendered at build time) and read the API through Next’s data cache (60 s); personal data is fetched client-side with TanStack Query and never cached publicly.
- The browser only talks to same-origin `/api/v1` (ingress or Next rewrite). No secrets exist in the frontend; only `NEXT_PUBLIC_APP_URL` is public.

## Contracts
The API is versioned under `/api/v1`. OpenAPI is generated from the NestJS controllers/DTOs (`/api/docs` in non-production; `npm run openapi` exports `docs/openapi.json`). Frontend types live in `frontend/src/types/api.ts`; see [api.md](api.md).
