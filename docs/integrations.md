# External integrations: setup and verification

Every integration is implemented against the provider’s official SDK/API and is **inactive until credentials are configured**. Without credentials the app says so honestly (e.g. “Razorpay is not configured on this server”, Meet status `NOT_CONFIGURED`) — it never fakes a payment, event, meeting or email. Status of each provider is visible in **Admin › Integration health**.

---

## Razorpay (payments)

Implementation: `backend/src/integrations/razorpay/razorpay.gateway.ts` (official `razorpay` Node SDK v2.9 for Orders/Payments/Refunds; documented HMAC-SHA256 signature schemes, compared in constant time).

### Test-mode setup
1. Create a Razorpay account → Dashboard → switch to **Test mode**.
2. Settings → API Keys → **Generate test key**. Put the values in `backend/.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxx
   ```
3. Settings → Webhooks → **Add new webhook**:
   - URL: `https://<your-api-host>/api/v1/payments/razorpay/webhook` (for local testing expose port 4000 with a tunnel such as `ngrok http 4000` or `cloudflared`).
   - Secret: a long random string → `RAZORPAY_WEBHOOK_SECRET`.
   - Events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed`, `refund.failed`.
4. Settings → Payment capture: **automatic capture** recommended (the backend also captures explicitly if a payment arrives only `authorized`).
5. Restart the API and worker.

### Verify (test mode)
1. Log in as a verified student, book a slot, press **Pay**.
2. In Checkout use a Razorpay [test card](https://razorpay.com/docs/payments/payments/test-card-details/) or test UPI (`success@razorpay`).
3. Expect: booking page shows **Payment verified — session confirmed**; Admin › Payments shows the order/payment ids as `CAPTURED`; Admin › Integration health has no failed webhooks.
4. Failure path: use `failure@razorpay` → booking stays reserved, “Payment not completed” is shown, you can retry within the hold.
5. Refund path: cancel a confirmed booking more than 24 h ahead → refund appears as `SUBMITTED`, then `PROCESSED` after the `refund.processed` webhook.
6. Late payment path: let a hold expire while the Checkout modal is open, then pay → booking is not confirmed if the slot was taken, and a full refund is issued automatically.

### Going live
Switch the dashboard to Live mode, generate **live** keys and a separate live webhook (new secret), complete Razorpay KYC/activation, and replace the three env vars. Admin › Integration health shows `live mode`. Never mix test and live keys; the API logs a warning if test keys are used with `NODE_ENV=production`.

---

## Google Calendar and Google Meet (teachers)

Implementation: `backend/src/integrations/google/google-calendar.gateway.ts` (official `@googleapis/calendar` client + `google-auth-library`, Calendar API v3). Meet links are created with `conferenceData.createRequest` (`conferenceSolutionKey.type = hangoutsMeet`) and `conferenceDataVersion=1`. Google may return the conference as `pending`; the worker polls `events.get` with backoff until it is `success` or `failure`. Event ids are deterministic (`tm<bookingId hex>`), so retries can never create duplicate events; each conference request id is unique per attempt.

### Google Cloud setup
1. Create a project in Google Cloud Console.
2. **APIs & Services → Library → enable “Google Calendar API”.**
3. **OAuth consent screen:** user type *External*; app name, support email, authorised domain (your production domain), privacy policy URL (`https://<app>/legal/privacy`) and terms URL.
   - Scopes: `openid`, `email`, `https://www.googleapis.com/auth/calendar.events` (the narrowest scope that can create/update/delete events with Meet conferences).
   - While in *Testing*, add teacher Google accounts as test users.
4. **Credentials → Create OAuth client ID → Web application.**
   - Authorised redirect URIs (must match exactly):
     - local: `http://localhost:4000/api/v1/integrations/google/callback`
     - production: `https://<your-domain>/api/v1/integrations/google/callback`
5. Put the values in `backend/.env`:
   ```
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxxxxxx
   GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/integrations/google/callback
   DATA_ENCRYPTION_KEY=<openssl rand -base64 32>
   ```
6. **Production verification:** `calendar.events` is a *sensitive* scope. Before more than 100 external users can connect, submit the app for Google OAuth verification (branding, domain verification in Search Console, demo video of the consent flow, justification of the scope). Plan 1–4 weeks.

### Flow
Teacher → *Google Calendar* page → **Connect** → backend creates a single-use `state` stored in Redis (10 min) and in an `HttpOnly` cookie → Google consent (`access_type=offline`, `prompt=consent`) → callback validates both copies of `state`, exchanges the code, checks that `calendar.events` was granted, encrypts the refresh token (AES-256-GCM) and stores it. Disconnect revokes the token at Google.

### Verify
1. Connect a teacher’s Google account (must be a test user while the consent screen is in Testing).
2. Book and pay for a session with that teacher.
3. Expect within ~1 minute: an event in the teacher’s Google Calendar with the student as attendee, a Meet link on both booking pages, and a “Your Google Meet link…” email.
4. Reschedule → the event moves. Cancel → the event is deleted (attendees notified by Google).
5. Revoke access at <https://myaccount.google.com/permissions> → the next sync marks the connection `REVOKED`, the teacher gets a reconnect email and an alert banner, and affected meetings show a clear failure state with a **Retry** action.

Students are never asked for calendar access: they use **Add to Google Calendar** (template link) or download the `.ics` file.

---

## Email (transactional)

Implementation: `backend/src/integrations/email/smtp-email.provider.ts` (nodemailer, pooled SMTP). Any transactional provider with SMTP works: Amazon SES, Postmark, SendGrid, Resend, Mailgun. The provider boundary (`EmailProvider`) allows adding an HTTP-API adapter or SMS/WhatsApp channels without touching booking logic.

### Local
Mailpit runs in Docker Compose: SMTP on `localhost:1025`, inbox UI at <http://localhost:8025>. Emails are really delivered over SMTP — nothing is mocked.

### Production
```
SMTP_HOST=email-smtp.ap-south-1.amazonaws.com   # example: Amazon SES
SMTP_PORT=587
SMTP_SECURE=false          # STARTTLS on 587; use true for port 465
SMTP_USER=...
SMTP_PASSWORD=...
EMAIL_FROM="TeachMe <no-reply@yourdomain.com>"
SUPPORT_EMAIL=support@yourdomain.com
```
Configure SPF, DKIM and DMARC for the sending domain with your provider, and move out of any provider sandbox before launch.

### Delivery semantics
- A notification is `PENDING` until the provider **accepts** it and returns a message id (`SENT` + `providerMessageId`); queuing alone never marks it sent.
- Transient failures retry with exponential backoff (6 attempts from 30 s); 5xx SMTP replies are permanent (`FAILED`, no retry). Failures are visible and retryable in Admin › Integration health.
- Each logical message has a unique `dedupeKey`, so job retries and outbox replays cannot send duplicates.
- Templates (HTML + plain text) are editable in Admin › Notification templates; variables are HTML-escaped.

---

## Reminders
Default offsets: 24 h and 1 h before a session (Admin › System settings → `notifications.reminders`). Scheduled as delayed BullMQ jobs keyed by booking + offset + start time; a 5-minute sweeper repairs reminders lost to outages and skips reminders superseded by a nearer one. Reschedules create new jobs and old ones become no-ops; cancellations make all pending reminders no-ops.
