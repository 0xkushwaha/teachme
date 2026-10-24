/** Provider-neutral payment gateway boundary. Implemented by RazorpayGateway; faked in tests only. */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface ProviderOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string | null;
}

export interface ProviderPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  /** created | authorized | captured | refunded | failed */
  status: string;
  method?: string | null;
  captured?: boolean;
  error_code?: string | null;
  error_description?: string | null;
  amount_refunded?: number;
}

export interface ProviderRefund {
  id: string;
  payment_id: string;
  amount: number;
  /** pending | processed | failed */
  status: string;
  notes?: Record<string, string> | unknown[];
}

export interface PaymentGateway {
  readonly configured: boolean;
  readonly publicKeyId: string;
  createOrder(input: { amountMinor: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<ProviderOrder>;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
  fetchOrderPayments(orderId: string): Promise<ProviderPayment[]>;
  capturePayment(paymentId: string, amountMinor: number, currency: string): Promise<ProviderPayment>;
  createRefund(paymentId: string, input: { amountMinor: number; receipt: string; notes: Record<string, string> }): Promise<ProviderRefund>;
  listRefunds(paymentId: string): Promise<ProviderRefund[]>;
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly providerCode?: string,
  ) {
    super(message);
  }
  /** 4xx (other than 429) means retrying the same request will not help. */
  get retryable() {
    return !this.statusCode || this.statusCode >= 500 || this.statusCode === 429;
  }
}
