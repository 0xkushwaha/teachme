# API reference

Base URL: `/api/v1` (URI versioning). Interactive OpenAPI docs: `http://localhost:4000/api/docs` (disabled when `NODE_ENV=production`). Export the spec with `cd backend && npm run openapi` → `docs/openapi.json`.

## Conventions

**Authentication**
- Browsers: HttpOnly cookies set by `POST /auth/login` / `register` / `refresh`. Call `GET /auth/csrf` first; send `X-CSRF-Token: <tm_csrf cookie>` on every POST/PUT/PATCH/DELETE.
- Programmatic clients: `POST /auth/token` → `{ accessToken, refreshToken, expiresIn }`; send `Authorization: Bearer <accessToken>`; refresh with `POST /auth/refresh { refreshToken }`.

**Idempotency** — `POST /bookings`, `POST /payments/orders`, `POST /bookings/:id/reschedule` require `Idempotency-Key` (8–128 chars `[A-Za-z0-9_-:.]`). Same key + same body → the stored response is replayed with `Idempotent-Replayed: true`; same key + different body → `422 IDEMPOTENCY_CONFLICT`; concurrent duplicate → `409`. Keys live 24 h per user.

**Pagination** — `?page=1&pageSize=20` (max 100) → `{ data: [...], meta: { page, pageSize, total, totalPages } }`.

**Errors** — every error has the same envelope:
```json
{ "error": { "code": "SLOT_UNAVAILABLE", "message": "That time was just booked…", "details": [...], "requestId": "b3c1…" } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Body/query failed validation (`details` lists messages) |
| `UNAUTHENTICATED` | 401 | Missing/expired session |
| `INVALID_CREDENTIALS` | 401/400 | Wrong email/password |
| `FORBIDDEN` | 403 | Role not allowed |
| `CSRF_INVALID` | 403 | Missing/invalid CSRF token or foreign Origin |
| `EMAIL_NOT_VERIFIED` | 403 | Verify email first |
| `ACCOUNT_INACTIVE` | 403 | Suspended/deactivated |
| `FEATURE_DISABLED` | 403 | Turned off by an admin flag |
| `NOT_FOUND` | 404 | Not found **or not yours** |
| `EMAIL_TAKEN`, `CONFLICT`, `IDEMPOTENCY_CONFLICT` | 409 | Uniqueness / concurrency |
| `SLOT_UNAVAILABLE` | 409 | Overlaps an existing session or hold |
| `BOOKING_INVALID_STATE`, `BOOKING_POLICY_VIOLATION`, `TEACHER_UNAVAILABLE` | 422 | Business rule violation |
| `ACCOUNT_LOCKED`, `RATE_LIMITED` | 429 | Too many attempts |
| `PAYMENT_VERIFICATION_FAILED` | 400 | Bad Razorpay signature |
| `PAYMENT_PROVIDER_ERROR` | 502 | Razorpay unavailable |
| `INTEGRATION_NOT_CONFIGURED` | 503 | Provider credentials not set |
| `INTERNAL` | 500 | Unexpected; details are in server logs by `requestId` |

Money is always integer minor units (`*Minor`, paise). Times are ISO-8601 UTC instants.

## Endpoints

### Auth `/auth`
| Method | Path | Notes |
|---|---|---|
| GET | `/csrf` | Sets `tm_csrf`, returns `{ csrfToken }` |
| POST | `/register` | `{ email, password, fullName, role: STUDENT\|TEACHER, timezone?, acceptTerms: true }` → signs in; sends verification email |
| POST | `/login` | `{ email, password }` → cookies + `{ user }` |
| POST | `/token` | Same body → tokens in body (no cookies, no CSRF) |
| POST | `/refresh` | Rotates refresh token (cookie or `{ refreshToken }`) |
| POST | `/logout` | Revokes the token family |
| GET | `/me` | Current user |
| POST | `/verify-email` | `{ token }` |
| POST | `/resend-verification` | 3 per 5 min |
| POST | `/forgot-password` | `{ email }` → always 202 |
| POST | `/reset-password` | `{ token, password }` → revokes all sessions |
| POST | `/change-password` | `{ currentPassword, newPassword }` |

### Catalogue (public)
| Method | Path | Notes |
|---|---|---|
| GET | `/subjects` | Categories → subjects with teacher counts and starting rates |
| GET | `/subjects/:slug` | |
| GET | `/teachers` | `subject, q, minPrice, maxPrice (minor), language, availableOn (1–7), minExperience, sort (recommended\|price_asc\|price_desc\|experience\|newest), page, pageSize` |
| GET | `/teachers/:slug` | Public profile + cancellation policy |
| GET | `/teachers/:id/quote` | `subjectId, durationMinutes` → price breakdown, hold length, policies |
| GET | `/availability/teachers/:teacherId/slots` | `from, to (≤ 42 days), durationMinutes` → `{ timezone, slots: [{ startAt, endAt }] }` (never cached) |
| GET | `/platform/config` | Fees, policies, booking rules, registration flags, banner, counts |

Example:
```bash
curl "http://localhost:4000/api/v1/teachers?subject=physics&sort=price_asc&pageSize=5"
```

### Bookings `/bookings`
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/` | verified student | `{ teacherId, subjectId, startAt, durationMinutes, note? }` + `Idempotency-Key` → `201` booking in `PENDING_PAYMENT` with `holdExpiresAt` |
| GET | `/` | student/teacher | `scope=upcoming\|pending\|past\|cancelled\|all` |
| GET | `/teacher/calendar` | teacher | `from, to (≤ 45 days)` |
| GET | `/:id` | participant/admin | Includes payment, refunds, meeting, history |
| POST | `/:id/cancel` | participant/admin | `{ reason? }` → `{ booking, refund: { refundMinor, percent, rule } }` |
| POST | `/:id/reschedule` | participant/admin | `{ startAt }` + `Idempotency-Key` |
| GET | `/:id/ics` | participant/admin | `text/calendar` |

Example (programmatic):
```bash
TOKEN=$(curl -s -X POST localhost:4000/api/v1/auth/token -H 'content-type: application/json' \
  -d '{"email":"aanya.student@teachme.dev","password":"<seed password>"}' | jq -r .accessToken)
curl -X POST localhost:4000/api/v1/bookings -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"teacherId":"…","subjectId":"…","startAt":"2026-11-02T12:30:00.000Z","durationMinutes":60}'
```

### Payments `/payments`
| Method | Path | Notes |
|---|---|---|
| POST | `/orders` | `{ bookingId }` + `Idempotency-Key` → `{ keyId, orderId, amountMinor, currency, holdExpiresAt, description, prefill }`; reuses an open order |
| POST | `/razorpay/verify` | `{ bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature }` → `{ outcome: confirmed\|already_confirmed\|pending\|failed\|conflict_refunded\|mismatch }` |
| POST | `/razorpay/client-failure` | Informational only |
| POST | `/razorpay/webhook` | Razorpay → API; `X-Razorpay-Signature` over raw body, `X-Razorpay-Event-Id` for idempotency |

### Meetings & Google
| Method | Path | Who |
|---|---|---|
| GET | `/meetings/booking/:bookingId` | participant/admin (join URL only when confirmed) |
| POST | `/meetings/booking/:bookingId/retry` | teacher/admin |
| GET | `/integrations/google/status` | teacher |
| POST | `/integrations/google/connect` | teacher → `{ url }` |
| GET | `/integrations/google/callback` | Google redirect |
| DELETE | `/integrations/google/connection` | teacher |

### Teacher self-service
`GET/PATCH /teachers/me`, `PUT /teachers/me/subjects`, `GET /teachers/me/overview`, `GET /availability/me`, `PUT /availability/me/weekly`, `POST/DELETE /availability/me/exceptions[/:id]`, `PATCH /availability/me/settings`.

### Account, notifications, support
`PATCH /users/me`, `GET /users/me/export`, `POST /users/me/delete { password, confirm: "DELETE" }`, `GET/PATCH /students/me`, `GET /students/me/overview`, `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `GET/PUT /notifications/preferences`, `POST /support/tickets`, `GET /support/tickets/mine`.

### Admin `/admin` (ADMIN only, audited)
`GET overview?days=`, `GET users`, `PATCH users/:id/status`, `PATCH users/:id/role`, `GET teachers`, `POST teachers/:id/approval`, `GET|POST subjects`, `PATCH subjects/:id`, `GET|POST categories`, `PATCH categories/:id`, `GET bookings`, `GET bookings/:id`, `POST bookings/:id/cancel { reason, refundPercent }`, `GET payments?discrepancy=true`, `POST payments/:id/reconcile`, `POST payments/:id/resolve`, `GET refunds`, `POST refunds/:id/retry`, `GET integrations/health`, `GET jobs`, `POST jobs/:id/retry`, `GET webhooks`, `GET notification-templates`, `PUT|DELETE notification-templates/:key`, `GET notification-templates/:key/preview`, `GET audit-logs`, `GET settings`, `PUT settings/:key { value }`, `GET support-tickets`, `PATCH support-tickets/:id`.

### Operations
`GET /api/v1/health/live`, `GET /api/v1/health/ready` (DB + Redis), `GET /metrics` (Prometheus; `Authorization: Bearer $METRICS_TOKEN`).
