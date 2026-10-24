import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'FAQ' };

const GROUPS: { id: string; title: string; items: [string, React.ReactNode][] }[] = [
  {
    id: 'students',
    title: 'Booking & sessions',
    items: [
      ['How do I join my session?', 'Open the booking from your dashboard and press “Join Google Meet”. The link is also in your confirmation email and reminders. You don’t need a Google account to join as a guest, though the teacher may need to admit you.'],
      ['What if the Meet link isn’t there yet?', 'Meet links are created by Google when your teacher’s calendar receives the booking — usually within a minute. If it’s still missing close to the start time, your booking page shows the status and you can contact support.'],
      ['Can someone else book the same slot while I pay?', 'No. When you continue to payment we reserve the slot for a few minutes. If payment doesn’t complete in time, the slot is released.'],
      ['Which timezone are times shown in?', 'Always yours. You can change your timezone in Settings; the teacher sees the same session in theirs.'],
      ['Can I add sessions to my calendar?', 'Yes — every confirmed booking has “Add to Google Calendar” and a downloadable .ics file for Apple Calendar or Outlook. We never ask students for calendar access.'],
    ],
  },
  {
    id: 'payments',
    title: 'Payments & refunds',
    items: [
      ['How do I pay?', 'Through Razorpay Checkout: UPI, cards, netbanking and wallets. TeachMe never sees your card details.'],
      ['My money was deducted but the booking isn’t confirmed.', 'We confirm only after verifying the payment with Razorpay, which occasionally takes a few minutes. If the slot was lost in the meantime, we refund you in full automatically. You can track the status on the booking page.'],
      ['How long do refunds take?', 'We start refunds immediately. Banks usually credit them within 5–7 working days.'],
      ['What’s the cancellation policy?', <>See the <Link className="text-accent underline-offset-4 hover:underline" href="/legal/cancellation">cancellation & refund policy</Link>. The exact refund is always shown before you confirm a cancellation.</>],
    ],
  },
  {
    id: 'teachers',
    title: 'For teachers',
    items: [
      ['How do I become a teacher?', 'Register as a teacher, complete your profile, subjects and availability. Our team reviews your profile — usually within two working days.'],
      ['Why do you need Google Calendar access?', 'To add each confirmed session to your calendar and create its Google Meet link. We request only the “manage events” permission, not access to read your whole calendar settings, and you can disconnect at any time.'],
      ['What happens if I need to cancel?', 'Cancel from the booking page with a short note. The student is refunded in full and notified immediately.'],
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <PageHeader eyebrow="Help" title="Frequently asked questions" description={<>Can’t find your answer? <Link href="/contact" className="text-accent underline-offset-4 hover:underline">Contact support</Link>.</>} />
      <div className="space-y-10">
        {GROUPS.map((g) => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-h`} className="scroll-mt-24">
            <h2 id={`${g.id}-h`} className="mb-3 text-lg font-semibold">{g.title}</h2>
            <div className="divide-y divide-border rounded-2xl border border-border bg-surface">
              {g.items.map(([q, a]) => (
                <details key={q} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {q}
                    <span className="text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>+</span>
                  </summary>
                  <div className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{a}</div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
