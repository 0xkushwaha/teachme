import { expect, type Page } from '@playwright/test';

export const API = 'http://localhost:4100/api/v1';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/**
 * Replaces Razorpay's checkout.js with a stub that behaves like a customer completing payment:
 * it asks the test backend to create a captured payment and returns Razorpay's signed response
 * to the app's handler. Everything after that (signature check, settlement) is real.
 */
export async function stubRazorpayCheckout(page: Page) {
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.Razorpay = function (opts) { this.opts = opts; this.handlers = {}; };
        window.Razorpay.prototype.on = function (ev, cb) { this.handlers[ev] = cb; };
        window.Razorpay.prototype.open = function () {
          var o = this.opts;
          fetch('/api/v1/__test__/razorpay/pay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: o.order_id }) })
            .then(function (r) { return r.json(); })
            .then(function (resp) { o.handler(resp); });
        };`,
    }),
  );
}

/** Polls Mailpit (real SMTP sink) for the newest email to an address and returns its plain text. */
export async function latestEmail(to: string, subjectIncludes: string) {
  let text = '';
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const json = (await res.json()) as { messages: { ID: string; Subject: string }[] };
        const msg = json.messages.find((m) => m.Subject.includes(subjectIncludes));
        if (!msg) return false;
        const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { Text: string };
        text = full.Text;
        return true;
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  return text;
}

export function uniqueEmail(prefix: string) {
  return `${prefix}+${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
}

export async function login(page: Page, email: string, password: string, next = '') {
  await page.goto(`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}
