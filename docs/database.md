# Database

PostgreSQL 16, managed through Prisma (`backend/prisma/schema.prisma`) with version-controlled migrations in `backend/prisma/migrations`. Constraints Prisma cannot express are hand-written in the first migration.

## Conventions
- **Time:** every timestamp is `timestamptz(3)` in UTC. Teacher weekly hours are stored as *local minutes from midnight* plus the teacher’s IANA timezone, so they stay correct across DST; one-off exceptions are absolute UTC instants. The UI converts to the viewer’s timezone.
- **Money:** integer **minor units** (`*Minor`, paise). Rates are basis points. No floats anywhere in the money path; rounding is integer half-up (`utils/money.ts`). A CHECK constraint enforces `totalMinor = priceMinor + platformFeeMinor + taxMinor`.
- **IDs:** UUID v4. Provider identifiers (`providerOrderId`, `providerPaymentId`, `providerRefundId`, webhook `eventId`, Google `providerEventId`, `conferenceRequestId`) are stored and **unique**.
- **Secrets:** passwords only as Argon2id hashes; refresh and one-time tokens only as SHA-256 hashes; Google refresh tokens AES-256-GCM encrypted. Razorpay/Google client secrets live in environment variables, never in the database.

## Models
| Model | Purpose |
|---|---|
| `User` | Account, role (`STUDENT`/`TEACHER`/`ADMIN`), status (`ACTIVE`/`SUSPENDED`/`DEACTIVATED`/`DELETED`), timezone, lockout counters, consent time |
| `Session` | Rotating refresh tokens (hash, family, rotation time) for reuse detection |
| `VerificationToken` | Email verification and password reset (hashed, single-use, expiring) |
| `StudentProfile` / `TeacherProfile` | Role-specific profile; teacher approval status, durations, buffer, notice, advance window |
| `SubjectCategory` / `Subject` / `TeacherSubject` | Catalogue and per-teacher hourly rate per subject |
| `TeacherAvailability` | Weekly windows (ISO weekday, start/end minute, local) |
| `AvailabilityException` | Holidays/breaks (`UNAVAILABLE`) and extra hours (`AVAILABLE`) |
| `Booking` | The session; times, `blockedUntil` (= end + buffer), price breakdown, status, hold expiry, policy snapshot, version |
| `BookingStatusHistory` | Append-only audit of every status change and reschedule |
| `Payment` / `Refund` | Razorpay order/payment/refund state, refunded total, discrepancy flags |
| `WebhookEvent` | Every verified provider webhook, unique by `(provider, eventId)`, with processing result |
| `CalendarConnection` / `CalendarEvent` / `Meeting` | Google connection (encrypted token, status), synced event, Meet conference state |
| `Notification` / `NotificationPreference` / `NotificationTemplate` | In-app + email messages with delivery status and provider id; per-channel preferences; admin overrides of default templates |
| `OutboxEvent` | Transactional outbox |
| `JobRecord` | Durable record of tracked integration jobs (status, attempts, last error) for ops and retry |
| `IdempotencyKey` | Stored responses for idempotent endpoints (24 h) |
| `AuditLog` | Security and admin actions |
| `PlatformSetting` | Validated JSON settings and feature flags (defaults in code) |
| `SupportTicket` | Contact form and booking issue reports |

## Constraints that protect correctness
| Constraint | Why |
|---|---|
| `booking_no_overlap` — `EXCLUDE USING gist (teacherId WITH =, tstzrange(startAt, blockedUntil) WITH &&) WHERE status IN (PENDING_PAYMENT, CONFIRMED, COMPLETED)` | **The double-booking guarantee.** Two slot-holding bookings for one teacher can never overlap (including buffer), regardless of concurrency, app bugs or retries. Enforced atomically by PostgreSQL under READ COMMITTED. |
| `booking_student_no_overlap` — same, on `studentId`, `[startAt, endAt)`, for `PENDING_PAYMENT`/`CONFIRMED` | A student cannot hold two overlapping sessions. |
| `booking_time_valid`, `booking_duration_valid`, `booking_money_valid`, `booking_hold_required` | Sane times, 15–240 min, money totals add up, holds always have an expiry. |
| `availability_window_valid`, `exception_window_valid`, `teacher_profile_limits`, `teacher_subject_rate_positive` | Reject impossible availability and pricing. |
| `payment_amount_positive`, `payment_refund_bounded`, `refund_amount_positive` | Refunds can never exceed the captured amount. |
| `user_email_lowercase` | One account per email regardless of case. |
| Unique: `Payment.providerOrderId`, `Payment.providerPaymentId`, `Refund.providerRefundId`, `WebhookEvent(provider,eventId)`, `CalendarEvent.providerEventId`, `Meeting.conferenceRequestId`, `Notification.dedupeKey`, `IdempotencyKey(userId,key)`, `Session.tokenHash` | Provider transactions and side effects are recorded exactly once. |

Stale `PENDING_PAYMENT` holds are expired **inside the reserving transaction** (and every minute by the worker), so an expired hold never blocks a slot even if the worker is down.

## Indexes
| Index | Serves |
|---|---|
| `Booking(teacherId, startAt)` + the GiST exclusion index | Availability/busy-range lookups, teacher calendar, overlap checks |
| `Booking(studentId, startAt)` | Student dashboards and lists |
| `Booking(status, holdExpiresAt)` | Hold expiry sweep |
| `Booking(status, startAt)` | Reminder sweep, completion job, admin filters |
| `TeacherAvailability(teacherId, dayOfWeek)`, `AvailabilityException(teacherId, startAt, endAt)` | Slot computation |
| `TeacherSubject(subjectId, isActive, hourlyRateMinor)`, `TeacherProfile(approvalStatus)` | Teacher search by subject and price |
| `Payment(status, createdAt)`, `Payment(discrepancy)`, `Payment(bookingId)` | Reconciliation and the admin discrepancy view |
| `Refund(status)`, `WebhookEvent(provider, processedAt)` | Refund polling, failed-webhook view |
| `Notification(userId, channel, readAt)` / `(userId, channel, createdAt)` / `(status, channel)` | Unread counter, inbox, delivery dashboards |
| `OutboxEvent(status, availableAt)` | Dispatcher claim query |
| `JobRecord(status, updatedAt)` | Failed-job dashboard |
| `AuditLog(entityType, entityId)`, `(actorId, createdAt)`, `(action, createdAt)`, `(createdAt)` | Audit filters |
| `Session(userId)`, `(familyId)`, `(expiresAt)` | Revocation and cleanup |

## Retention and deletion
Implemented by the daily `maintenance.retention` job and the account-deletion flow:

| Data | Retention |
|---|---|
| Idempotency keys | 24 h |
| Refresh sessions | deleted 1 day after expiry / 30 days after revocation |
| Verification/reset tokens | 30 days after use or expiry |
| Dispatched outbox events (tokens scrubbed at dispatch) | 14 days |
| Successful job records | 30 days |
| Processed webhook payloads | 180 days |
| Notifications | 365 days |
| Bookings, payments, refunds | Retained for financial record-keeping; personal details removed on account deletion |
| Audit logs | Retained (security); review against your legal retention requirements before launch |

Account deletion (`POST /users/me/delete`) erases sessions, tokens, calendar connections (revoked at Google), notifications and preferences, clears profile fields and pseudonymises the user row (`deleted+<id>@deleted.invalid`). It is blocked while upcoming sessions exist.

## Commands
```bash
cd backend
npx prisma migrate deploy        # apply migrations (CI, staging, production)
npm run db:seed                  # development data (refuses NODE_ENV=production)
npx prisma migrate dev --name x  # create a new migration during development
```
Backups and restore: see [deployment.md](deployment.md#backups-and-restore).
