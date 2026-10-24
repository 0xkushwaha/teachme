/**
 * TEST-ONLY provider fakes. They replace network calls to Razorpay / Google / SMTP so automated
 * tests never touch real accounts. Signature verification is NOT faked: FakePaymentGateway
 * inherits the real HMAC checks from RazorpayGateway.
 */
import { createHmac } from 'crypto';
import { RazorpayGateway } from '../../src/integrations/razorpay/razorpay.gateway';
import { PaymentProviderError, ProviderOrder, ProviderPayment, ProviderRefund } from '../../src/integrations/razorpay/payment-gateway';
import { CalendarEventInput, CalendarEventResult, CalendarGateway, CalendarProviderError, OAuthTokens } from '../../src/integrations/google/calendar-gateway';
import { EmailDeliveryError, EmailMessage, EmailProvider } from '../../src/integrations/email/email-provider';
import type { AppConfig } from '../../src/config/app-config';

let seq = 0;
const id = (p: string) => `${p}_T${Date.now().toString(36)}${(++seq).toString(36)}`;

export class FakePaymentGateway extends RazorpayGateway {
  orders = new Map<string, ProviderOrder>();
  payments = new Map<string, ProviderPayment>();
  refunds = new Map<string, ProviderRefund>();
  failCreateOrder = false;

  constructor(private readonly cfg: AppConfig) {
    super(cfg);
  }

  override get configured() {
    return true;
  }

  override async createOrder(input: { amountMinor: number; currency: string; receipt: string }) {
    if (this.failCreateOrder) throw new PaymentProviderError('Gateway unavailable', 503);
    const order = { id: id('order'), amount: input.amountMinor, currency: input.currency, status: 'created', receipt: input.receipt };
    this.orders.set(order.id, order);
    return order;
  }

  /** Simulates the customer paying in Checkout. Returns what Checkout hands to the browser. */
  pay(orderId: string, opts: { status?: 'captured' | 'authorized' | 'failed'; amount?: number } = {}) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`unknown order ${orderId}`);
    const payment: ProviderPayment = {
      id: id('pay'),
      order_id: orderId,
      amount: opts.amount ?? order.amount,
      currency: order.currency,
      status: opts.status ?? 'captured',
      method: 'upi',
      error_description: opts.status === 'failed' ? 'Payment declined by bank' : null,
    };
    this.payments.set(payment.id, payment);
    const signature = createHmac('sha256', this.cfg.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${payment.id}`).digest('hex');
    return { razorpay_order_id: orderId, razorpay_payment_id: payment.id, razorpay_signature: signature, payment };
  }

  override async fetchPayment(paymentId: string) {
    const p = this.payments.get(paymentId);
    if (!p) throw new PaymentProviderError('not found', 404);
    return { ...p };
  }

  override async fetchOrderPayments(orderId: string) {
    return [...this.payments.values()].filter((p) => p.order_id === orderId);
  }

  override async capturePayment(paymentId: string) {
    const p = this.payments.get(paymentId)!;
    p.status = 'captured';
    return { ...p };
  }

  override async createRefund(paymentId: string, input: { amountMinor: number; notes: Record<string, string> }) {
    const r: ProviderRefund = { id: id('rfnd'), payment_id: paymentId, amount: input.amountMinor, status: 'pending', notes: input.notes };
    this.refunds.set(r.id, r);
    return { ...r };
  }

  override async listRefunds(paymentId: string) {
    return [...this.refunds.values()].filter((r) => r.payment_id === paymentId);
  }

  webhookSignature(body: string) {
    return createHmac('sha256', this.cfg.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  }
}

export class FakeCalendarGateway implements CalendarGateway {
  configured = true;
  events = new Map<string, CalendarEventInput & { meetStatus: string; joinUrl: string | null; cancelled?: boolean }>();
  inserts = 0;
  /** Meet status returned on insert; subsequent get() returns success. */
  meetOnInsert: 'pending' | 'success' | 'failure' = 'pending';
  revoked = false;
  failNext: CalendarProviderError | null = null;

  buildAuthUrl(state: string) {
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
  }
  async exchangeCode(): Promise<OAuthTokens> {
    return { refreshToken: '1//fake-refresh', accessToken: 'ya29.fake', scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'], email: 'teacher@gmail.test' };
  }
  async revoke() {}

  private check() {
    if (this.revoked) throw new CalendarProviderError('invalid_grant', 400, true);
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }

  private result(eventId: string): CalendarEventResult {
    const e = this.events.get(eventId)!;
    return {
      id: eventId,
      status: e.cancelled ? 'cancelled' : 'confirmed',
      meet: e.conferenceRequestId ? { status: e.meetStatus, joinUrl: e.joinUrl, conferenceId: e.joinUrl ? 'abc-defg-hij' : null } : null,
    };
  }

  async insertEvent(_t: string, input: CalendarEventInput) {
    this.check();
    if (this.events.has(input.eventId)) return this.result(input.eventId); // 409 → existing, like the real adapter
    this.inserts++;
    this.events.set(input.eventId, {
      ...input,
      meetStatus: input.conferenceRequestId ? this.meetOnInsert : 'none',
      joinUrl: this.meetOnInsert === 'success' ? `https://meet.google.com/${input.conferenceRequestId?.slice(-12)}` : null,
    });
    return this.result(input.eventId);
  }

  async getEvent(_t: string, eventId: string) {
    this.check();
    const e = this.events.get(eventId);
    if (!e) return null;
    if (e.meetStatus === 'pending') {
      e.meetStatus = 'success';
      e.joinUrl = `https://meet.google.com/fake-${eventId.slice(-6)}`;
    }
    return this.result(eventId);
  }

  async updateEvent(_t: string, input: CalendarEventInput) {
    this.check();
    const e = this.events.get(input.eventId)!;
    Object.assign(e, { startIso: input.startIso, endIso: input.endIso });
    if (input.conferenceRequestId && e.meetStatus !== 'success') {
      e.conferenceRequestId = input.conferenceRequestId;
      e.meetStatus = this.meetOnInsert;
      e.joinUrl = this.meetOnInsert === 'success' ? `https://meet.google.com/retry-${input.eventId.slice(-6)}` : null;
    }
    return this.result(input.eventId);
  }

  async cancelEvent(_t: string, eventId: string) {
    this.check();
    const e = this.events.get(eventId);
    if (e) e.cancelled = true;
  }
}

export class FakeEmailProvider implements EmailProvider {
  configured = true;
  name = 'fake';
  sent: (EmailMessage & { messageId: string })[] = [];
  failTimes = 0;
  permanentFail = false;

  async send(message: EmailMessage) {
    if (this.permanentFail) throw new EmailDeliveryError('550 mailbox does not exist', true);
    if (this.failTimes > 0) {
      this.failTimes--;
      throw new EmailDeliveryError('421 try again later');
    }
    const messageId = `<${id('msg')}@fake.smtp>`;
    this.sent.push({ ...message, messageId });
    return { messageId };
  }
}
