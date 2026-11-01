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

## Stepped concurrency test: 100 → 500 → 1,000 → 2,000 users (1 Nov 2026, session 4)

Scenario `loadtest/concurrency-tiers.js` (run: `./scripts/run-loadtest.sh concurrency-tiers`, after `npx ts-node --transpile-only scripts/loadtest-seed.ts` for fresh tokens). Raw output: `loadtest-results/concurrency-tiers.{json,txt}`, resource samples `loadtest-results/resources.csv`.

**Model.** Closed model: each virtual user is one *concurrently active* user with 3–8 s think time between page views. Each tier ramps for 30 s, holds for 2 min, then ramps down; 20 s gap between tiers. Personas by VU: 55 % anonymous visitors (subjects, filtered/sorted search, teacher profile, 7-day slots), 30 % students (me/overview/unread, booking history, payments; password login via Argon2id on 1 in 20 iterations; reserve + release a real slot on 1 in 15), 10 % teachers (overview, earnings summary, 12-week/12-month series, ledger, upcoming bookings, application), 5 % admins (overview, review queue, booking search, finance summary, payout queue). Data: 3,169 users, 163 teachers, 18,002 bookings.

**Environment.** Same as above: one Apple M2 laptop (8 cores, 8 GB) running the production build of **one** API process (`connection_limit=40`) and one worker, PostgreSQL 16 and Redis 7 in Docker Desktop (4 GB VM), **and the k6 load generator in the same Docker VM**. Every tier competes with k6 for the same CPUs, so these numbers are conservative.

| Tier (concurrent users) | Requests | Throughput (steady) | Errors | p50 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|
| 100 | 4,144 | ≈ 26 req/s | **0 %** | 12 ms | **30 ms** | 70 ms | 154 ms |
| 500 | 20,830 | ≈ 130 req/s | **0 %** | 5 ms | **21 ms** | 68 ms | 712 ms |
| 1,000 | 41,456 | ≈ 259 req/s | **0 %** | 4 ms | **144 ms** | 675 ms | 2.9 s |
| 2,000 | 81,672 | ≈ 510 req/s | **0 %** | 11 ms | **356 ms** | 851 ms | 3.9 s |

148,104 requests in total; **147,518 / 147,518 checks passed**; 584 real reservations created and released; all 2,000 VUs reached.

p95 by workflow (ms):

| Tier | Browse/search | Student dashboard & history | Teacher dashboard & earnings | Admin operations | Login (Argon2id) | Reserve slot |
|---|---|---|---|---|---|---|
| 100 | 21 | 29 | 33 | 83 | 73 | 67 |
| 500 | 13 | 16 | 23 | 67 | 51 | 56 |
| 1,000 | 103 | 134 | 170 | 287 | 43 | **1,990** |
| 2,000 | 319 | 379 | 394 | 423 | 116 | **1,619** |

Resource usage during each steady hold (average / max over 5 s samples; 100 % = one core):

| Tier | API CPU | API RSS | PostgreSQL CPU | PostgreSQL mem | Redis CPU | Worker CPU |
|---|---|---|---|---|---|---|
| 100 | 23 / 43 % | 145 MiB | 13 / 20 % | 430 MiB | 2 % | ~0 % |
| 500 | 48 / 61 % | 141 MiB | 62 / 575 % | 610 MiB | 3 % | 1 % |
| 1,000 | 63 / 123 % | 149 MiB | 105 / 515 % | 951 MiB | 5 % | 1 % |
| 2,000 | 144 / 204 % | 153 MiB | **220 / 441 %** | 998 MiB | 14 % | 1 % |

Event-loop lag p99 at the end of the run: 19 ms.

### What this shows, and what it does not
- **Up to 500 concurrent active users** one API process is far inside the 500 ms p95 target for every workflow.
- **At 1,000 and 2,000** every request still succeeded and overall p95 stayed under 500 ms (144 / 356 ms), but the **tail is no longer acceptable**: p99 reached 0.7–0.9 s, and **slot reservation p95 was 1.6–2.0 s**. Against the 500 ms target, this single-machine setup supports ~500 concurrent users comfortably and 1,000–2,000 with degraded tails. **It does not demonstrate production-quality service for 2,000 concurrent users.**
- **Bottleneck: PostgreSQL CPU** (2.2 cores average, bursts to 4–6 cores at 2,000 users) on a laptop it shares with the load generator, and the 40-connection pool in front of it. The API process itself used ~1.4 cores and 150 MiB, and Redis and the worker were idle. Reservations suffer most because each runs a multi-statement transaction (stale-hold expiry, exclusion-checked insert, history row, idempotency record) that waits for both a pool connection and DB CPU.
- Not measured here: multiple API replicas, network latency between tiers, the Next.js frontend (SSR) under load, external providers.

### Improvements for 1,000–2,000 concurrent users (in order)
1. Run PostgreSQL on dedicated hardware (≥ 4 vCPU managed instance) and the load generator on a separate host; re-run this scenario on staging. This is the single largest factor.
2. Run 2–3 API replicas (stateless already; Redis-backed rate limits and `SKIP LOCKED` outbox are multi-replica safe), keeping total connections under `max_connections` via PgBouncer (transaction mode) as described in [deployment.md](deployment.md).
3. Cache the most frequent anonymous reads for a few seconds (teacher search pages and public profiles; availability stays uncached for correctness), and the admin overview/finance aggregates for 30–60 s.
4. Enable `pg_stat_statements` on staging to rank queries by total time before changing indexes; the new earnings/payout/review queries are already indexed (see [database.md](database.md)).

## Capacity interpretation (original mixed workload)
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
