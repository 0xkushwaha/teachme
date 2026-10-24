# Security

## Authentication
- **Passwords:** Argon2id (19 MiB, t=2, p=1 — OWASP baseline), rehashed on login if parameters change. Policy: 10–128 chars with upper, lower and a digit. Login timing is equalised for unknown emails.
- **Lockout:** 5 consecutive failures lock the account for 15 minutes; every failure is audited.
- **Browser sessions:** a 15-minute HS256 access JWT in an `HttpOnly; SameSite=Lax; Secure` cookie (`tm_at`) and an opaque 384-bit refresh token in an `HttpOnly` cookie scoped to `/api/v1/auth` (`tm_rt`). Refresh tokens rotate on every use; replaying a rotated token outside a 30-second multi-tab grace window **revokes the whole token family**. Password reset revokes all sessions.
- **API clients:** `POST /auth/token` returns tokens in the body for Bearer use (mobile apps, load tests). Bearer requests are not subject to CSRF.
- **Every request re-reads the user** (status, role, verification), so suspensions, deactivations and role changes take effect immediately, not when the token expires.
- **Email verification** is required before booking. Verification and reset tokens are 256-bit random, stored hashed, single-use, and expire in 24 h / 1 h. Forgot-password never reveals whether an account exists.

## CSRF, CORS and headers
- Unsafe cookie-authenticated requests need **both** an allowed `Origin`/`Referer` and a double-submit token (`X-CSRF-Token` header equal to the readable `tm_csrf` cookie). Webhooks are exempt and authenticated by signature.
- CORS allows only `CORS_ORIGINS` with credentials; in production UI and API share an origin behind the ingress.
- API: Helmet with `default-src 'none'`, `frame-ancestors 'none'`, HSTS in production, `x-powered-by` removed. Frontend: CSP allowing only self plus Razorpay Checkout origins, `nosniff`, strict referrer policy, restricted permissions policy.

## Authorization
- Role checks are declared with `@Roles()` and enforced by the global `AuthGuard` on the server; hiding UI is never relied on. All `/admin/*` routes are `ADMIN`-only at controller level.
- **Object-level checks** in services: a booking is visible/actionable only to its student, its teacher or an admin (others get `404` to avoid enumeration); payments are verified only by the booking’s student; Meet links are returned only for confirmed sessions to participants; teachers see only the student fields relevant to the session (name, level, goals, note).
- The server never trusts client-supplied prices, amounts, roles, teacher eligibility or booking states. Unknown body fields are rejected (`forbidNonWhitelisted`).
- Admins cannot change their own role/status; role and status changes revoke the target’s sessions. All admin mutations write `AuditLog` entries.

### Endpoint authorization review (pre-deployment)
| Area | Anonymous | Student | Teacher | Admin | Object check |
|---|---|---|---|---|---|
| `GET /subjects*`, `GET /teachers`, `GET /teachers/:slug`, `GET /teachers/:id/quote`, `GET /availability/teachers/:id/slots`, `GET /platform/config` | ✓ | ✓ | ✓ | ✓ | approved/active only |
| `POST /auth/register|login|token|refresh|logout|verify-email|forgot-password|reset-password`, `GET /auth/csrf` | ✓ (rate limited) | | | | token-bound |
| `GET /auth/me`, `POST /auth/resend-verification|change-password`, `/users/me*`, `/notifications*` | | ✓ | ✓ | ✓ | self |
| `/students/me*` | | ✓ | | | self |
| `/teachers/me*`, `/availability/me*`, `/integrations/google/*` (except callback) | | | ✓ | | own profile |
| `GET /integrations/google/callback` | ✓ | | | | single-use state bound to Redis **and** browser cookie |
| `POST /bookings` | | ✓ verified | | | server-side eligibility |
| `GET /bookings`, `GET /bookings/teacher/calendar` | | ✓ own | ✓ own | | owner filter in query |
| `GET /bookings/:id`, `/:id/ics`, `POST /:id/cancel`, `POST /:id/reschedule`, `GET /meetings/booking/:id` | | ✓ | ✓ | ✓ | participant or admin (404 otherwise) |
| `POST /meetings/booking/:id/retry` | | | ✓ | ✓ | participant or admin |
| `POST /payments/orders`, `/payments/razorpay/verify`, `/client-failure` | | ✓ | | | booking’s student |
| `POST /payments/razorpay/webhook` | signature only | | | | HMAC over raw body |
| `POST /support/tickets` | ✓ | ✓ | ✓ | ✓ | booking reference attached only if caller is a participant |
| `/admin/*` | | | | ✓ | audited |
| `GET /health/*` | ✓ | | | | no data |
| `GET /metrics` | Bearer `METRICS_TOKEN`; blocked at ingress | | | | |

This table is enforced by guards and covered by `test/integration/rbac-idempotency.spec.ts` and `test/unit/authorization.spec.ts`.

## Rate limiting and abuse prevention
Redis-backed (shared across replicas), keyed per user when signed in, otherwise per client IP (`TRUST_PROXY` must match the number of proxy hops so spoofed `X-Forwarded-For` is ignored):
- Global default `THROTTLE_GLOBAL_LIMIT`/min (300).
- Login/register/token/reset: 10/min; forgot-password: 5 per 5 min; resend verification: 3 per 5 min.
- Booking creation 15/min; cancel/reschedule 10/min; payment orders/verify 20/min; support tickets 5 per 10 min; data export / deletion 3/hour.
- Edge limit in nginx (30 r/s per IP, burst 60); webhooks exempt (signature-verified, provider retries).

## Payments
- Razorpay key secret and webhook secret exist only in backend env. The browser receives only `keyId`, `orderId`, amount and currency.
- Checkout signature: `HMAC_SHA256(order_id + "|" + payment_id, key_secret)`; webhook signature: `HMAC_SHA256(raw_body, webhook_secret)`; both compared in **constant time**. The raw body is preserved (`rawBody: true`) — parsed JSON is never re-serialised for verification.
- A valid signature is not enough: the server fetches the payment from Razorpay and checks order id, amount, currency and status before confirming. Mismatches become admin-visible discrepancies.

## Data protection
- Encryption in transit: TLS at the ingress; use TLS to managed Postgres/Redis (`sslmode=require`, `rediss://`).
- Encryption at rest: managed database/storage encryption, plus application-level AES-256-GCM for Google refresh tokens (`DATA_ENCRYPTION_KEY`, 32 bytes).
- **Log redaction** (pino): authorization/cookie/CSRF/signature headers, `set-cookie`, passwords, tokens, refresh tokens, signatures, encrypted tokens, emails, phone numbers, card/VPA fields. Query strings are stripped from logged URLs. 5xx responses never include stack traces or internal messages.
- **Email templates** escape every variable; admins cannot use raw interpolation, scripts or inline event handlers; previews render in a sandboxed iframe.
- **Output encoding**: React escapes by default; no `dangerouslySetInnerHTML` with user content (only the static theme bootstrap script).
- **SSRF**: the server only calls fixed provider hosts (Razorpay, Google, SMTP host from config); no user-supplied URLs are fetched. Teacher avatar URLs are restricted to `https://` and rendered as images only.
- **SQL injection**: Prisma parameterises all queries; raw SQL uses tagged templates (`Prisma.sql`) with bound parameters only.
- **Privacy**: explicit consent at registration (`privacyConsentAt`), data export (`GET /users/me/export`), account deletion, documented retention ([database.md](database.md#retention-and-deletion)). Students never grant calendar access; they use a template link or `.ics`.

## Secrets management
- `.env` files are git-ignored; only `.env.example` files with placeholders are committed.
- Production secrets are injected by the platform secret manager (e.g. AWS Secrets Manager / GCP Secret Manager / Doppler). Rotate `JWT_ACCESS_SECRET` (logs everyone out within 15 min), Razorpay keys and webhook secret, SMTP credentials and `METRICS_TOKEN` on a schedule or after any suspected exposure. Rotating `DATA_ENCRYPTION_KEY` requires re-encrypting `CalendarConnection.encryptedRefreshToken` (or asking teachers to reconnect).
- Production boot validation refuses `COOKIE_SECURE=false` and a missing `METRICS_TOKEN`.

## Dependency hygiene
`npm audit --omit=dev --audit-level=high` runs in CI for both apps (both currently report **0 vulnerabilities**); Dependabot opens weekly update PRs. Versions are pinned exactly (`save-exact`) with lockfiles. Transitive fixes are pinned with npm `overrides` — backend: `multer` 2.5.0, `deepmerge-ts` 8.0.2, `js-yaml` 5.5.0; frontend: `postcss` 8.5.31 — remove each once the parent package ships the fix.

## Known gaps (before public launch)
- No multi-factor authentication for admins (recommended: TOTP or SSO for the admin role).
- No malware scanning because the platform accepts no file uploads; revisit if uploads are added.
- Legal pages are a solid starting draft but must be reviewed by counsel for your jurisdiction (India DPDP Act 2023, GST invoicing obligations, consumer protection rules).
