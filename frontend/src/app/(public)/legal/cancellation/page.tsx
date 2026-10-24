import type { Metadata } from 'next';
import { serverGet } from '@/lib/server-api';
import type { PlatformConfig } from '@/types/api';
import { LegalPage } from '../legal-page';

export const metadata: Metadata = { title: 'Cancellation & refund policy' };

export default async function Cancellation() {
  const c = await serverGet<PlatformConfig>('/platform/config');
  const p = c?.policy;
  return (
    <LegalPage title="Cancellation & refund policy" updated="24 October 2026">
      <p>The policy in effect when you book is saved with your booking, so later changes never affect sessions you’ve already paid for. Your booking page always shows the exact refund before you confirm a cancellation.</p>
      <h2>Student cancellations</h2>
      {p ? (
        <ul>
          <li>Cancel at least <strong>{p.cancellation.fullRefundHours} hours</strong> before the start: full refund.</li>
          <li>Cancel at least <strong>{p.cancellation.partialRefundHours} hours</strong> before the start: {p.cancellation.partialRefundPercent}% refund.</li>
          <li>Later than that, or after the session has started: no refund.</li>
        </ul>
      ) : (
        <p>Policy details are temporarily unavailable; they are always shown on the booking page.</p>
      )}
      <h2>Teacher cancellations</h2>
      <p>If your teacher cancels, you receive a full refund, whatever the timing.</p>
      <h2>Rescheduling</h2>
      {p && <p>You can move a confirmed session to another open slot with the same teacher up to {p.reschedule.maxReschedules} times, provided at least {p.reschedule.minHoursBefore} hours remain before it starts.</p>}
      <h2>Payment problems</h2>
      <ul>
        <li>If a payment completes after your reservation expired and the slot was taken, we refund the full amount automatically.</li>
        <li>Unfinished checkouts are never charged; any amount your bank shows as pending is released by the bank.</li>
      </ul>
      <h2>Refund timing</h2>
      <p>Refunds are issued to the original payment method through Razorpay. Banks typically credit them within 5–7 working days. You can follow the status on your booking page and by email.</p>
    </LegalPage>
  );
}
