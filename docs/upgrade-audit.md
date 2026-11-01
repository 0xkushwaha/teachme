# Upgrade audit — three-role platform (session 4)

_Audit date: 2026-11-01. Branch: `upgrade/three-role-platform` (from `main` @ 7f13a06)._

This audit was done before changing anything. It records what already existed, what the upgrade
brief asked for that was missing, and the strategy used to add it without rebuilding.

## 1. Current architecture (as found)

| Layer | Found |
|---|---|
| Frontend | Next.js 15 App Router, React 19, Tailwind 4, TanStack Query, RHF + Zod. Same-origin `/api/v1` proxy, HttpOnly cookies. Route groups: `(public)`, `(auth)`, `student/`, `teacher/`, `admin/`, each with its own `DashboardShell` navigation. |
| Backend | NestJS 11 modular monolith (`auth`, `users`, `students`, `teachers`, `availability`, `bookings`, `payments`, `calendar`, `meetings`, `notifications`, `support`, `subjects`, `analytics`, `admin`) + separate worker entrypoint. |
| Data | PostgreSQL 16 via Prisma 6 (1 migration). Hand-written SQL: `btree_gist` exclusion constraints for teacher/student overlap, CHECK constraints on money and time ranges. |
| Async | Transactional outbox → BullMQ (Redis) queues: email, calendar/Meet, refunds, reminders, maintenance. |
| Auth | Argon2id, 15-min JWT access cookie + rotating refresh tokens with reuse detection, CSRF double-submit + Origin check, lockout after 5 failures, email verification, password reset, Bearer tokens for API clients. |
| RBAC | Global `AuthGuard` re-reads the user on every request (suspension/role change is immediate) and enforces `@Roles(...)`; object-level checks in services (bookings return 404 to non-owners). |
| Integrations | Razorpay (orders, signature verify, webhooks, refunds, reconciliation), Google Calendar + Meet, SMTP (Mailpit locally). |
| Ops | `/health/live`, `/health/ready`, Prometheus `/metrics`, pino with redaction, Redis-backed rate limiting, Dockerfiles, nginx, prod compose, CI, k6 load tests. |

## 2. Existing features (verified working)

- **Students:** register/login/verify/reset, browse + filter teachers, profiles with live slots, book → pay → confirm, upcoming/past/cancelled sessions, cancel with policy-based refund, reschedule, .ics, notifications + preferences, settings, data export, account deletion, support form.
- **Teachers:** overview + setup checklist, calendar, bookings, booking detail, weekly availability + exceptions + rules, profile/subjects/rates, Google Calendar connection, notifications, settings.
- **Admins:** analytics overview, user list + suspend/role change, teacher approval queue, subjects, bookings + admin cancel with refund %, payments/refunds/discrepancies, integration health + job retry, templates, audit log, settings/feature flags, support tickets.
- **Integrity:** double booking impossible by exclusion constraint (300-way race → 1 winner in load test); compare-and-set state machine; idempotency keys; payments confirm only after server-side verification.

## 3. Missing or incomplete against the brief

| # | Gap | Severity |
|---|---|---|
| G1 | **No teacher invitation flow.** Teachers self-register (approval still required). No admin invite, token, expiry, resend, revoke. | High (explicit requirement) |
| G2 | **No document upload.** Qualifications are free-text JSON; admins cannot review evidence. Avatar is a pasted external URL (hotlinking/tracking risk). No multipart handling anywhere. | High |
| G3 | **No explicit application submission.** A teacher is `PENDING` from sign-up; admins can't tell "still drafting" from "ready for review". Rejections carry no reason to the teacher, and there is no resubmission path. | Medium |
| G4 | **No teacher earnings ledger.** The overview sums `priceMinor` of CONFIRMED + COMPLETED bookings in the last 30 days — counts unearned (future) sessions and ignores refunds. No pending/available/paid split, no weekly/monthly series. | High (financial correctness) |
| G5 | **No payouts.** No payout request, approval, or record. (No payout *provider* integration exists, and none is invented — see §6.) | High |
| G6 | **No financial reporting** for admins beyond the 30-day revenue tile. No teacher-earnings or payout liability view, no CSV export. | Medium |
| G7 | **No student payment history / receipts page.** Payment data exists per booking only. | Medium |
| G8 | **Teachers cannot mark a session completed.** Completion happens only via the maintenance job. | Low |
| G9 | **No announcements** beyond a single maintenance banner. | Low |
| G10 | **Admin cannot remove an account** (only suspend/deactivate). | Low |
| G11 | No templates for invitation, registration confirmation, application submitted, payout updates. | Medium (needed by G1/G3/G5) |

## 4. Security review findings

Existing controls are strong (see `docs/security.md`). Findings for this upgrade:

| Finding | Action |
|---|---|
| Open teacher self-registration (default on) lets anyone create a TEACHER-role account. They cannot be booked until approved, but the brief requires preventing unauthorised teacher registration. | Default `features.flags.teacherRegistration` → **off** (invite-only); admins can reopen applications. Invitation acceptance is the only other path to a TEACHER account. |
| Avatar URL accepts any https URL → third-party tracking pixel on student pages, mixed trust. | Replace with server-side upload (type sniffed from magic bytes, size-limited, served from our origin with `nosniff` + sandbox CSP). URL field kept for backward compatibility but restricted to our own file path. |
| No upload surface existed; adding one introduces risk (polyglots, MIME spoofing, path traversal, IDOR on documents). | Bytes validated by signature, not extension or client MIME; stored in Postgres (no filesystem paths); documents served only to the owning teacher and to admins (audited), always as `attachment` with `nosniff` and `sandbox` CSP. |
| Financial records mutable through ORM. | Earnings ledger rows are append-only, enforced by a database trigger (amount/teacher/booking immutable, no DELETE). Payout state changes are compare-and-set. |

## 5. Scalability notes

Measured previously (`docs/load-testing.md`): ~290 req/s with p95 9–13 ms for reads on one API process and 202 concurrent VUs. **The 1,000–2,000 concurrent-user tiers were never measured.** This session adds stepped 100/500/1,000/2,000 VU scenarios and reports what was actually achieved on the available hardware — without claiming more.

New code is designed not to regress this: earnings are summarised with indexed aggregates, file blobs are never selected in list queries, invitations and payouts are low-volume admin paths.

## 6. Implementation strategy

Extend, don't replace. All schema changes go through one new Prisma migration (additive only; no existing data dropped).

1. **Schema:** `TeacherInvitation`, `StoredFile`, `TeacherDocument`, `TeacherEarning` (append-only), `TeacherPayout`, `Announcement`; new columns on `TeacherProfile` (`applicationSubmittedAt`, `rejectionReason`). Backfill earnings for already-completed paid bookings.
2. **Invitations (G1):** admin invite/resend/revoke; hashed single-use expiring tokens; acceptance creates a verified TEACHER account in one transaction with a compare-and-set claim; invite-only by default.
3. **Onboarding (G2, G3):** document + avatar upload; explicit "submit application"; approval requires a submitted application; rejection reason emailed; resubmission allowed.
4. **Earnings (G4, G5, G8):** ledger row written in the same transaction as the COMPLETED transition (unique per booking); teacher-marked completion after session end; payouts as **manual** records (request → admin approve → admin marks paid with bank reference). No money is moved by the platform; this is documented, not faked.
5. **Admin (G6, G9, G10):** finance summary + CSV, payout queue, teacher detail with documents, announcements, account removal with typed confirmation.
6. **Student (G7):** payment history + printable receipt.
7. **Tests:** integration specs for every new workflow and authorization boundary; unit tests for file sniffing and earning maths; existing suites must stay green.
8. **Load test:** stepped VU tiers; honest results.

UI work extends the existing design system (cards, tables, dialogs, skeletons, empty states) rather than restyling it; the current UI already meets most of the brief's visual requirements.
