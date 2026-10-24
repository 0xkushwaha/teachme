/** Loads Razorpay Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/). */
export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (r: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void; escape?: boolean; confirm_close?: boolean };
  retry?: { enabled: boolean; max_count?: number };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: 'payment.failed', cb: (r: { error: { description?: string; reason?: string; code?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (o: RazorpayOptions) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;
export function loadRazorpay(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Browser only'));
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load the payment window. Check your connection or disable blockers and retry.'));
    };
    document.body.appendChild(s);
  });
  return loading;
}

export function openRazorpay(o: RazorpayOptions) {
  if (!window.Razorpay) throw new Error('Razorpay not loaded');
  const rzp = new window.Razorpay(o);
  return rzp;
}
