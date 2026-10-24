import type { Quote } from '@/types/api';
import { formatMoney } from '@/utils/format';

export function PriceSummary({ price, currency = 'INR', taxLabel }: { price: { priceMinor: number; platformFeeMinor: number; taxMinor: number; totalMinor: number }; currency?: string; taxLabel?: string }) {
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between"><dt className="text-muted-foreground">Session</dt><dd className="tabular-nums">{formatMoney(price.priceMinor, currency)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted-foreground">Platform fee</dt><dd className="tabular-nums">{formatMoney(price.platformFeeMinor, currency)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted-foreground">{taxLabel ?? 'Taxes'}</dt><dd className="tabular-nums">{formatMoney(price.taxMinor, currency)}</dd></div>
      <div className="flex justify-between border-t border-border pt-2 text-[15px] font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(price.totalMinor, currency)}</dd></div>
    </dl>
  );
}

export function taxLabelFor(q: Pick<Quote, 'taxBps' | 'taxBase'>) {
  return `GST (${q.taxBps / 100}% on ${q.taxBase === 'PLATFORM_FEE' ? 'platform fee' : 'subtotal'})`;
}

export function PolicyText({ policy }: { policy: Quote['policy'] }) {
  const c = policy.cancellation;
  const r = policy.reschedule;
  return (
    <ul className="space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
      <li>Full refund if you cancel at least <strong className="text-foreground">{c.fullRefundHours}h</strong> before the session.</li>
      <li>{c.partialRefundPercent}% refund if you cancel at least {c.partialRefundHours}h before; no refund after that.</li>
      <li>If your teacher cancels, you get a full refund.</li>
      <li>Reschedule up to {r.maxReschedules}× when at least {r.minHoursBefore}h remain.</li>
    </ul>
  );
}
