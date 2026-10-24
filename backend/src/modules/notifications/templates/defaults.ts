import { NotificationCategory } from '@prisma/client';

export interface TemplateDefinition {
  key: string;
  description: string;
  category: NotificationCategory;
  /** Security/transactional mail that cannot be switched off in preferences. */
  mandatory: boolean;
  subject: string;
  html: string;
  text: string;
  /** Short in-app notification text (not admin-editable). */
  inApp: string;
}

const sessionBlock = `
<table role="presentation" class="card" width="100%">
  <tr><td class="label">Subject</td><td>{{session.subject}}</td></tr>
  <tr><td class="label">With</td><td>{{session.counterpart}}</td></tr>
  <tr><td class="label">When</td><td>{{session.time}}</td></tr>
  <tr><td class="label">Duration</td><td>{{session.duration}} minutes</td></tr>
</table>`;

const sessionText = `Subject: {{session.subject}}
With: {{session.counterpart}}
When: {{session.time}}
Duration: {{session.duration}} minutes`;

const meetHtml = `{{#if meet.url}}<p><a class="button" href="{{meet.url}}">Join Google Meet</a></p><p class="muted">Meet link: {{meet.url}}</p>{{/if}}`;
const meetText = `{{#if meet.url}}Google Meet: {{meet.url}}
{{/if}}`;

export const TEMPLATE_DEFAULTS: TemplateDefinition[] = [
  {
    key: 'verify_email',
    description: 'Sent after registration and on resend',
    category: 'ACCOUNT',
    mandatory: true,
    subject: 'Verify your TeachMe email address',
    html: `<h1>Confirm your email</h1><p>Hi {{user.name}},</p><p>Please confirm this is your email address so you can book and manage sessions.</p><p><a class="button" href="{{link}}">Verify email</a></p><p class="muted">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`,
    text: `Hi {{user.name}},\n\nConfirm your email address: {{link}}\n\nThis link expires in 24 hours. If you didn't create an account, ignore this email.`,
    inApp: 'Check your inbox to verify your email address.',
  },
  {
    key: 'password_reset',
    description: 'Password reset link',
    category: 'ACCOUNT',
    mandatory: true,
    subject: 'Reset your TeachMe password',
    html: `<h1>Reset your password</h1><p>Hi {{user.name}},</p><p>We received a request to reset your password.</p><p><a class="button" href="{{link}}">Choose a new password</a></p><p class="muted">This link expires in 1 hour and can be used once. If you didn't request it, your account is still secure and you can ignore this email.</p>`,
    text: `Hi {{user.name}},\n\nReset your password: {{link}}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
    inApp: 'A password reset was requested for your account.',
  },
  {
    key: 'booking_confirmed',
    description: 'Student: payment verified and session confirmed',
    category: 'BOOKING',
    mandatory: true,
    subject: 'Confirmed: {{session.subject}} with {{session.counterpart}}',
    html: `<h1>Your session is confirmed</h1><p>Hi {{user.name}}, your payment of {{payment.amount}} was verified.</p>${sessionBlock}${meetHtml}{{#if meet.pending}}<p class="muted">Your Google Meet link is being prepared — we'll email it as soon as it's ready.</p>{{/if}}<p><a href="{{booking.url}}">View booking</a> · <a href="{{booking.icsUrl}}">Add to calendar</a></p><p class="muted">{{policy.text}}</p>`,
    text: `Hi {{user.name}}, your payment of {{payment.amount}} was verified.\n\n${sessionText}\n${meetText}\nView booking: {{booking.url}}\n\n{{policy.text}}`,
    inApp: '{{session.subject}} with {{session.counterpart}} on {{session.time}} is confirmed.',
  },
  {
    key: 'teacher_new_booking',
    description: 'Teacher: a student booked a session',
    category: 'BOOKING',
    mandatory: false,
    subject: 'New booking: {{session.subject}} with {{session.counterpart}}',
    html: `<h1>You have a new session</h1><p>Hi {{user.name}},</p>${sessionBlock}{{#if session.note}}<p><strong>Note from the student:</strong> {{session.note}}</p>{{/if}}${meetHtml}<p><a href="{{booking.url}}">Open in dashboard</a></p>`,
    text: `Hi {{user.name}}, you have a new session.\n\n${sessionText}\n{{#if session.note}}Note: {{session.note}}\n{{/if}}${meetText}\nOpen: {{booking.url}}`,
    inApp: 'New booking: {{session.subject}} with {{session.counterpart}} on {{session.time}}.',
  },
  {
    key: 'booking_cancelled',
    description: 'Both parties: session cancelled',
    category: 'BOOKING',
    mandatory: true,
    subject: 'Cancelled: {{session.subject}} on {{session.time}}',
    html: `<h1>Session cancelled</h1><p>Hi {{user.name}}, this session was cancelled by {{cancel.by}}.</p>${sessionBlock}{{#if cancel.reason}}<p><strong>Reason:</strong> {{cancel.reason}}</p>{{/if}}{{#if refund.text}}<p>{{refund.text}}</p>{{/if}}<p><a href="{{booking.url}}">View details</a></p>`,
    text: `Hi {{user.name}}, this session was cancelled by {{cancel.by}}.\n\n${sessionText}\n{{#if cancel.reason}}Reason: {{cancel.reason}}\n{{/if}}{{#if refund.text}}{{refund.text}}\n{{/if}}\nDetails: {{booking.url}}`,
    inApp: '{{session.subject}} on {{session.time}} was cancelled.',
  },
  {
    key: 'booking_rescheduled',
    description: 'Both parties: session moved to a new time',
    category: 'BOOKING',
    mandatory: true,
    subject: 'Rescheduled: {{session.subject}} is now {{session.time}}',
    html: `<h1>Session rescheduled</h1><p>Hi {{user.name}}, your session has a new time.</p><p class="muted">Previously: {{previous.time}}</p>${sessionBlock}${meetHtml}<p><a href="{{booking.url}}">View booking</a></p>`,
    text: `Hi {{user.name}}, your session has a new time.\nPreviously: {{previous.time}}\n\n${sessionText}\n${meetText}\nView: {{booking.url}}`,
    inApp: '{{session.subject}} moved to {{session.time}}.',
  },
  {
    key: 'meet_ready',
    description: 'Both parties: Google Meet link created',
    category: 'BOOKING',
    mandatory: false,
    subject: 'Your Google Meet link for {{session.subject}}',
    html: `<h1>Your meeting link is ready</h1><p>Hi {{user.name}},</p>${sessionBlock}${meetHtml}`,
    text: `Hi {{user.name}}, your meeting link is ready.\n\n${sessionText}\n${meetText}`,
    inApp: 'Google Meet link ready for {{session.subject}} on {{session.time}}.',
  },
  {
    key: 'session_reminder',
    description: 'Both parties: upcoming session reminder (timing configurable)',
    category: 'REMINDER',
    mandatory: false,
    subject: 'Reminder: {{session.subject}} starts {{reminder.when}}',
    html: `<h1>Your session starts {{reminder.when}}</h1><p>Hi {{user.name}},</p>${sessionBlock}${meetHtml}{{#if meet.missing}}<p class="muted">The meeting link isn't available yet. Open the booking for the latest status or contact support.</p>{{/if}}<p><a href="{{booking.url}}">View booking</a> · Need to change plans? You can reschedule or cancel from the booking page according to the cancellation policy.</p>`,
    text: `Hi {{user.name}}, your session starts {{reminder.when}}.\n\n${sessionText}\n${meetText}\nView booking: {{booking.url}}`,
    inApp: '{{session.subject}} starts {{reminder.when}}.',
  },
  {
    key: 'payment_failed',
    description: 'Student: payment attempt failed',
    category: 'PAYMENT',
    mandatory: false,
    subject: 'Payment unsuccessful for {{session.subject}}',
    html: `<h1>Payment didn't go through</h1><p>Hi {{user.name}}, your payment for the session below failed{{#if payment.reason}}: {{payment.reason}}{{/if}}. No money was taken for this attempt.</p>${sessionBlock}<p>You can retry from the booking page while your slot is reserved.</p><p><a href="{{booking.url}}">Retry payment</a></p>`,
    text: `Hi {{user.name}}, your payment failed{{#if payment.reason}}: {{payment.reason}}{{/if}}.\n\n${sessionText}\n\nRetry: {{booking.url}}`,
    inApp: 'Payment for {{session.subject}} failed.',
  },
  {
    key: 'payment_conflict',
    description: 'Student: payment arrived after the slot was lost — full refund issued',
    category: 'PAYMENT',
    mandatory: true,
    subject: "We couldn't confirm your session — full refund issued",
    html: `<h1>Your payment is being refunded</h1><p>Hi {{user.name}}, your payment of {{payment.amount}} was received after your reserved slot expired and the time is no longer available. We have started a full refund to your original payment method.</p>${sessionBlock}<p><a href="{{booking.url}}">View refund status</a></p>`,
    text: `Hi {{user.name}}, your payment of {{payment.amount}} arrived after the slot expired. A full refund has been initiated.\n\n${sessionText}\n\nStatus: {{booking.url}}`,
    inApp: 'Payment for {{session.subject}} is being refunded in full.',
  },
  {
    key: 'refund_update',
    description: 'Student: refund status changed',
    category: 'PAYMENT',
    mandatory: true,
    subject: 'Refund {{refund.status}}: {{refund.amount}}',
    html: `<h1>Refund {{refund.status}}</h1><p>Hi {{user.name}}, your refund of {{refund.amount}} for {{session.subject}} is <strong>{{refund.status}}</strong>.</p><p class="muted">{{refund.note}}</p><p><a href="{{booking.url}}">View booking</a></p>`,
    text: `Hi {{user.name}}, your refund of {{refund.amount}} for {{session.subject}} is {{refund.status}}.\n{{refund.note}}\n\n{{booking.url}}`,
    inApp: 'Refund of {{refund.amount}} is {{refund.status}}.',
  },
  {
    key: 'teacher_approval',
    description: 'Teacher: application approved / rejected / suspended',
    category: 'ACCOUNT',
    mandatory: true,
    subject: 'Your TeachMe teacher profile is {{approval.status}}',
    html: `<h1>Profile {{approval.status}}</h1><p>Hi {{user.name}},</p><p>{{approval.message}}</p><p><a class="button" href="{{dashboard.url}}">Open teacher dashboard</a></p>`,
    text: `Hi {{user.name}},\n\n{{approval.message}}\n\n{{dashboard.url}}`,
    inApp: 'Your teacher profile is {{approval.status}}.',
  },
  {
    key: 'calendar_reconnect',
    description: 'Teacher: Google Calendar access expired or was revoked',
    category: 'SYSTEM',
    mandatory: true,
    subject: 'Action needed: reconnect Google Calendar',
    html: `<h1>Reconnect Google Calendar</h1><p>Hi {{user.name}}, we could no longer access your Google Calendar, so new sessions can't get calendar events or Meet links.</p><p><a class="button" href="{{link}}">Reconnect now</a></p>`,
    text: `Hi {{user.name}}, reconnect Google Calendar so sessions get calendar events and Meet links: {{link}}`,
    inApp: 'Google Calendar access expired — reconnect to keep Meet links working.',
  },
  {
    key: 'admin_alert',
    description: 'Admins: critical operational failure',
    category: 'SYSTEM',
    mandatory: true,
    subject: '[TeachMe alert] {{alert.title}}',
    html: `<h1>{{alert.title}}</h1><p>{{alert.detail}}</p><p><a href="{{admin.url}}">Open integration health</a></p>`,
    text: `{{alert.title}}\n\n{{alert.detail}}\n\n{{admin.url}}`,
    inApp: '{{alert.title}}',
  },
];

export const TEMPLATE_BY_KEY = new Map(TEMPLATE_DEFAULTS.map((t) => [t.key, t]));

export function wrapEmailLayout(bodyHtml: string, opts: { appUrl: string; supportEmail: string; preheader?: string; prefsUrl?: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TeachMe</title>
<style>
body{margin:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827}
.wrap{max-width:560px;margin:0 auto;padding:32px 16px}
.panel{background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:32px}
h1{font-size:22px;line-height:1.3;margin:0 0 16px;letter-spacing:-0.01em}
p{font-size:15px;line-height:1.6;margin:0 0 14px}
.button{display:inline-block;background:#4f46e5;color:#ffffff !important;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600}
.card{border:1px solid #e5e7eb;border-radius:10px;padding:8px 14px;margin:8px 0 18px;border-collapse:separate;font-size:14px}
.card td{padding:6px 0;vertical-align:top}.label{color:#6b7280;width:96px}
.muted{color:#6b7280;font-size:13px}a{color:#4f46e5}
.foot{color:#9ca3af;font-size:12px;text-align:center;margin-top:20px;line-height:1.6}
</style></head><body>
<span style="display:none!important;opacity:0;height:0;width:0;overflow:hidden">${opts.preheader ?? ''}</span>
<div class="wrap"><div style="font-weight:700;font-size:18px;margin:0 0 16px 4px;color:#111827">Teach<span style="color:#4f46e5">Me</span></div>
<div class="panel">${bodyHtml}</div>
<div class="foot">You're receiving this because you have a TeachMe account.<br>
<a href="${opts.prefsUrl ?? opts.appUrl}">Notification preferences</a> · <a href="mailto:${opts.supportEmail}">${opts.supportEmail}</a></div>
</div></body></html>`;
}
