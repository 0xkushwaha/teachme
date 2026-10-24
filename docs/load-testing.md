# Load testing

Run on **24 October 2026** with k6 0.54 against a **production build** (`NODE_ENV=production`) of the API (1 Node process) and worker (1 process). Raw outputs: `loadtest-results/*.txt|json`, resource samples: `loadtest-results/resources-main.csv`. Re-run with `./scripts/run-loadtest.sh`.

## Test environment
| Item | Value |
|---|---|
| Machine | Apple M2, 8 cores, 8 GiB RAM, macOS 26.6 (laptop) |
| PostgreSQL 16.4 / Redis 7.4 | Docker Desktop VM (shared 3.8 GiB, 8 vCPU) |
| Load generator | k6 in Docker **on the same machine** (competes for CPU — results are conservative) |
| API | 1 instance, `connection_limit=40`, `TRUST_PROXY=1` |
| Data volume | 3,168 users (3,000 students), 162 approved teachers, 15,002 historical bookings, 18 subjects |
| Rate limits | Global per-client limit raised to 100k/min for this run (all traffic shares one host); **auth-route limits stay on** — k6 spreads clients over simulated IPs via `X-Forwarded-For`, as a load balancer would |

## Workload and results

### 1. Mixed read workload (3 min steady + ramps)
- **Browse** (anonymous): ramp to 120 VUs — subjects, filtered/sorted teacher search, teacher profile, 7-day availability slots, 1–3 s think time.
- **Dashboard** (signed in): 80 VUs — `/auth/me`, student overview, booking history (over 15k bookings), unread count, 2–5 s think time.
- **Logins**: 5/s constant arrival (Argon2id).

| Metric | Result | Target |
|---|---|---|
| Requests | 65,930 (290 req/s) | — |
| Errors | **0.00 %** | < 1 % ✅ |
| Public reads p50 / p95 / p99 | 3.3 / **9.1** / 28.1 ms | p95 < 500 ms ✅ |
| Dashboard p50 / p95 / p99 | 3.7 / **13.2** / 63.3 ms | p95 < 500 ms ✅ |
| Login p50 / p95 / p99 | 25.5 / **42.3** / 122.5 ms | p95 < 1.5 s ✅ |
| Peak concurrent VUs | 202 | — |

### 2. Peak slot contention
300 students submit `POST /bookings` for **the same teacher and slot at the same instant**.

| Metric | Result |
|---|---|
| Reservations created | **1** (threshold `count==1` ✅) |
| Rejected with `409 SLOT_UNAVAILABLE` | 299 |
| Errors / 5xx | **0** |
| Latency p95 / max | 537 / 545 ms (all 300 queued on the same row range) |

The database exclusion constraint serialises the contenders; there is no window in which two holds coexist.

### 3. Booking creation (write path)
25 reservations/s for 2 min across 150 teachers and 4 days of slots, each released (checkout abandoned) immediately.

| Metric | Result |
|---|---|
| Reservations attempted / created | 3,001 / 2,999 (2 natural slot collisions → 409, expected) |
| Releases | 2,999 / 2,999 succeeded |
| Reserve p50 / p95 / p99 | 18.6 / **24.6** / 33.5 ms |
| Release p95 | 16.5 ms |
| Server errors | 0 |

Each reservation runs the full server-side validation (eligibility, slot engine, pricing), stale-hold expiry and an exclusion-checked insert in one transaction, plus idempotency-key bookkeeping.

### 4. Payment webhook ingestion
50 HMAC-signed Razorpay webhooks/s for 1 min, ~20 % duplicate event ids (Razorpay retries).

| Metric | Result |
|---|---|
| Requests | 3,001, **0 % failed** |
| p50 / p95 / p99 | 11.1 / **17.2** / 20.1 ms |

Exercises raw-body signature verification and idempotent event recording. The settlement path itself (row locks, booking confirmation) is covered for correctness by integration tests rather than throughput, because confirmations require real Razorpay orders.

### 5. Background job processing (notifications)
1,000 email jobs enqueued at once; measured until every notification was **accepted by SMTP** (status `SENT` with a provider message id).

| Metric | Result |
|---|---|
| Delivered / failed | 1,000 / 0 |
| Time | 2.1 s → **≈ 478 emails/s** with 1 worker |

SMTP target is local Mailpit (near-zero latency). Real providers impose sending limits (e.g. SES default 14/s, raised on request); in production the provider’s rate limit, not the worker, will bound email throughput. Calendar/Meet jobs were not load tested against Google (provider latency and quotas are external); their idempotency and retry behaviour is covered by integration tests.

## Resource usage during scenarios 1–4
| Process | CPU avg | CPU max | Memory max |
|---|---|---|---|
| API (1 Node process) | 56 % | 123 % | 387 MiB |
| Worker | 0.4 % | 6 % | 213 MiB |
| PostgreSQL | 16 % | 104 % | 309 MiB |
| Redis | 2 % | 4 % | 20 MiB |

## Capacity interpretation
- **3,000 registered users** is a modest load. Assuming a generous 5–10 % concurrently active at peak (150–300 users), the measured ~200 concurrent virtual users with think time — plus 25 bookings/s and 5 logins/s — were served by **one** API process at ~0.5 core average with p95 latencies an order of magnitude under the 500 ms target.
- These results do **not** demonstrate 3,000 *simultaneous* active users; that was not tested. Extrapolating linearly is not safe, but the headroom (p95 ≈ 9–25 ms, one core) and stateless design suggest 2–4 API replicas behind a load balancer would handle it; validate on production-like infrastructure before claiming it.
- **Most expensive request:** login (Argon2id, ~25 ms CPU each). A login storm is CPU-bound — scale API replicas; per-IP auth limits cap abuse.
- **Contention latency:** hundreds of students racing for one slot wait on each other (~0.5 s at 300); correctness is unaffected.

## Known limitations of this test
- Single laptop; load generator, API and databases share CPU. Network latency between tiers is ~0.
- One API instance only; multi-replica behaviour (shared Redis rate limits, outbox `SKIP LOCKED`) is exercised by design and tests, not by this run.
- External providers (Razorpay, Google, real SMTP provider) excluded by design.
- Frontend (Next.js SSR) was not load tested; public pages render per request over a 60 s data cache, and static assets belong on a CDN.

**Recommendation:** repeat `./scripts/run-loadtest.sh` on staging (managed Postgres/Redis, 2 API replicas, load generator on a separate host) with `BROWSE_VUS`, `DASH_VUS`, `RATE` raised until p95 approaches 500 ms, and record the knee point here.
