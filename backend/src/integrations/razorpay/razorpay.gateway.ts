import { Injectable, Logger } from '@nestjs/common';
import Razorpay from 'razorpay';
import { AppConfig } from '../../config/app-config';
import { AppError } from '../../common/errors';
import { hmacSha256Hex, safeEqual } from '../../utils/crypto';
import {
  PaymentGateway,
  PaymentProviderError,
  ProviderOrder,
  ProviderPayment,
  ProviderRefund,
} from './payment-gateway';

const TIMEOUT_MS = 15_000;

/**
 * Razorpay implementation using the official `razorpay` Node SDK (Orders, Payments, Refunds APIs).
 * Signature checks follow Razorpay's documented HMAC-SHA256 scheme, compared in constant time:
 *   checkout: HMAC(order_id + "|" + payment_id, key_secret)
 *   webhook:  HMAC(raw request body, webhook_secret)
 */
@Injectable()
export class RazorpayGateway implements PaymentGateway {
  private readonly logger = new Logger(RazorpayGateway.name);
  private readonly client: Razorpay | null;

  constructor(private readonly config: AppConfig) {
    this.client = config.razorpayConfigured
      ? new Razorpay({ key_id: config.env.RAZORPAY_KEY_ID, key_secret: config.env.RAZORPAY_KEY_SECRET })
      : null;
    if (this.client && config.isProduction && config.env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) {
      this.logger.warn('Razorpay is running with TEST keys in production mode');
    }
  }

  get configured() {
    return this.client !== null;
  }

  get publicKeyId() {
    return this.config.env.RAZORPAY_KEY_ID;
  }

  private get rzp(): Razorpay {
    if (!this.client) throw AppError.notConfigured('Razorpay');
    return this.client;
  }

  async createOrder(input: { amountMinor: number; currency: string; receipt: string; notes: Record<string, string> }) {
    return this.call<ProviderOrder>('orders.create', () =>
      this.rzp.orders.create({
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt.slice(0, 40),
        notes: input.notes,
      }) as unknown as Promise<ProviderOrder>,
    );
  }

  async fetchPayment(paymentId: string) {
    return this.call<ProviderPayment>('payments.fetch', () => this.rzp.payments.fetch(paymentId) as unknown as Promise<ProviderPayment>);
  }

  async fetchOrderPayments(orderId: string) {
    const res = await this.call<{ items: ProviderPayment[] }>('orders.fetchPayments', () =>
      this.rzp.orders.fetchPayments(orderId) as unknown as Promise<{ items: ProviderPayment[] }>,
    );
    return res.items ?? [];
  }

  async capturePayment(paymentId: string, amountMinor: number, currency: string) {
    return this.call<ProviderPayment>('payments.capture', () =>
      this.rzp.payments.capture(paymentId, amountMinor, currency) as unknown as Promise<ProviderPayment>,
    );
  }

  async createRefund(paymentId: string, input: { amountMinor: number; receipt: string; notes: Record<string, string> }) {
    return this.call<ProviderRefund>('payments.refund', () =>
      this.rzp.payments.refund(paymentId, {
        amount: input.amountMinor,
        speed: 'normal',
        receipt: input.receipt.slice(0, 40),
        notes: input.notes,
      }) as unknown as Promise<ProviderRefund>,
    );
  }

  async listRefunds(paymentId: string) {
    const res = await this.call<{ items: ProviderRefund[] }>('payments.fetchMultipleRefund', () =>
      this.rzp.payments.fetchMultipleRefund(paymentId, { count: 100 }) as unknown as Promise<{ items: ProviderRefund[] }>,
    );
    return res.items ?? [];
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!this.config.env.RAZORPAY_KEY_SECRET) throw AppError.notConfigured('Razorpay');
    const expected = hmacSha256Hex(this.config.env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
    return safeEqual(expected, signature);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    if (!this.config.env.RAZORPAY_WEBHOOK_SECRET) throw AppError.notConfigured('Razorpay webhooks');
    const expected = hmacSha256Hex(this.config.env.RAZORPAY_WEBHOOK_SECRET, rawBody);
    return safeEqual(expected, signature);
  }

  private async call<T>(op: string, fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new PaymentProviderError(`Razorpay ${op} timed out`)), TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      if (err instanceof PaymentProviderError || err instanceof AppError) throw err;
      const e = err as { statusCode?: number; error?: { code?: string; description?: string } };
      const message = e.error?.description ?? (err as Error).message ?? 'Razorpay request failed';
      this.logger.warn({ op, statusCode: e.statusCode, code: e.error?.code }, `Razorpay ${op} failed: ${message}`);
      throw new PaymentProviderError(message, e.statusCode, e.error?.code);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
