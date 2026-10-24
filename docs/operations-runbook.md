# Operations runbook

Start every investigation at **Admin › Integration health** (providers, queues, outbox lag, failed jobs, unprocessed webhooks) and the `requestId` the user reports (every error shown in the UI includes one in the API response; search logs for it).

## “I paid but my booking isn’t confirmed”
1. Admin › Bookings → open the booking. Check `Payment` status, provider order/payment ids and history.
2. If the payment is `CREATED`/`AUTHORIZED`: press **Reconcile** on Admin › Payments. This fetches the order’s payments from Razorpay and settles them through the normal path (idempotent — safe to press repeatedly).
3. If the outcome is `conflict_refunded` the slot was lost before payment completed; a full refund was queued automatically and the student was emailed. Check the refund status.
4. If `mismatch`: amount/currency/order differ from what we created. Do **not** confirm manually; investigate in the Razorpay dashboard, then resolve the discrepancy with a note.
5. Check Admin › Integration health → Unprocessed webhooks. Persistent `webhook_signature_invalid` means `RAZORPAY_WEBHOOK_SECRET` doesn’t match the dashboard webhook.

## Refund stuck in `SUBMITTED` or `FAILED`
- `SUBMITTED` is normal for up to ~5 working days (bank processing). The reconciler polls every 10 min; the `refund.processed` webhook finalises it.
- `FAILED`: an admin alert was raised. Check the reason (e.g. insufficient Razorpay balance), fix it in Razorpay, then **Retry** in Admin › Payments › Refunds. Retrying never creates a second refund: the job first looks up refunds already created for that payment (tagged with our refund id).

## Meet link missing / calendar not syncing
1. Booking page (teacher or admin view) shows meeting and calendar status with the last error.
2. `NOT_CONFIGURED`: the teacher hasn’t connected Google or Google OAuth isn’t configured — ask the teacher to connect (Teacher › Google Calendar).
3. `REVOKED` connection: the teacher revoked access or the token expired. The teacher already received an email and dashboard banner; once they reconnect, press **Retry Meet** on each affected upcoming booking (or retry the failed `calendar.sync` jobs in Integration health).
4. Transient Google errors retry automatically (8 attempts, exponential backoff). Dead jobs can be retried from Integration health.
5. As a fallback, the teacher can share a meeting link with the student by email; record it on the support ticket.

## Emails not arriving
1. Integration health → Email: `failed` and `stuck > 10 min` counts.
2. `failed` with a 5xx reason (bad address, suppression list) is permanent — fix the address or provider suppression, then retry the job.
3. Many `PENDING`: the worker may be down or the SMTP provider is rate-limiting. Check the worker logs and queue `notifications` waiting count.
4. Verify SPF/DKIM/DMARC if emails land in spam.

## Queue or outbox backlog (alerts `OutboxBacklog`, `QueueBacklog`)
1. Is the worker running? `kubectl get pods` / `docker ps`; worker logs should show “Queue workers started”.
2. Is Redis reachable and **not evicting**? (`maxmemory-policy` must be `noeviction`.)
3. Scale workers horizontally; concurrency per queue is in `jobs/processors/queue-workers.service.ts`.
4. Outbox events that fail 10 times become `FAILED` and raise an admin alert; inspect `OutboxEvent.lastError`.

## Elevated 5xx / latency
1. Check `http_request_duration_seconds` by route, `nodejs_eventloop_lag_p99_seconds`, DB CPU and connections.
2. Database connection exhaustion: lower `connection_limit` per replica or add PgBouncer.
3. Hot login traffic is CPU-bound (Argon2): scale API replicas; confirm rate limits are active.
4. Roll back the last release if the regression coincides with a deploy.

## Redis lost or flushed
Survivable. Queues/caches/rate limits are rebuilt; the outbox re-dispatches pending events; the reconciler re-settles payments; the reminder sweeper re-sends reminders whose fire time passed (superseded ones are skipped). Users with in-progress Google OAuth must click Connect again.

## Restoring the database
Follow [deployment.md › Backups and restore](deployment.md#backups-and-restore), then run reconciliation.

## Suspending a teacher or student
Admin › Teachers → **Suspend** (hides profile; existing confirmed bookings remain — review them in Admin › Bookings and cancel with a refund if needed). Admin › Students & admins → **Suspend** signs the user out immediately. All actions are audited.

## Security incident
1. Rotate the affected secret (see [security.md › Secrets management](security.md#secrets-management)).
2. To force everyone to sign in again: rotate `JWT_ACCESS_SECRET` and run `UPDATE "Session" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;`.
3. Review Admin › Audit log (`auth.refresh_reuse_detected`, `auth.login_failed`, `payment.signature_invalid`, `admin.*`).

## Routine
| Frequency | Task |
|---|---|
| Daily (automatic) | Retention job; check Integration health and Discrepancies |
| Weekly | Review Dependabot PRs; scan audit log for unusual admin activity |
| Monthly | Review failed jobs and support tickets for recurring issues |
| Quarterly | Restore drill; rotate `METRICS_TOKEN`/SMTP credentials; review admin accounts |
