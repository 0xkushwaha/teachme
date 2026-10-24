import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { serverGet } from '@/lib/server-api';
import type { PlatformConfig } from '@/types/api';

export const metadata: Metadata = { title: 'Pricing & fees' };

export default async function PricingPage() {
  const c = await serverGet<PlatformConfig>('/platform/config');
  const fee = c ? c.pricing.platformFeeBps / 100 : null;
  const tax = c ? c.pricing.taxBps / 100 : null;
  // Worked example on a ₹1,000/hr, 60-minute session, using integer paise like the server.
  const example = c && {
    price: 100000,
    fee: Math.round((100000 * c.pricing.platformFeeBps) / 10000),
  };
  const exTax = c && example ? Math.round(((c.pricing.taxBase === 'PLATFORM_FEE' ? example.fee : example.price + example.fee) * c.pricing.taxBps) / 10000) : 0;
  const inr = (m: number) => `₹${(m / 100).toLocaleString('en-IN', { minimumFractionDigits: m % 100 ? 2 : 0 })}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <PageHeader eyebrow="Pricing" title="Pay per session. No subscriptions." description="Each teacher sets their own hourly rate. You see the full amount — including fees and taxes — before you pay." />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-6"><p className="text-[13px] text-muted-foreground">Teacher’s rate</p><p className="mt-2 text-2xl font-semibold">Set by teacher</p><p className="mt-2 text-sm text-muted-foreground">Shown per hour on every profile, prorated for 30/45/90-minute sessions.</p></Card>
        <Card className="p-6"><p className="text-[13px] text-muted-foreground">Platform fee</p><p className="mt-2 text-2xl font-semibold">{fee !== null ? `${fee}%` : '—'}</p><p className="mt-2 text-sm text-muted-foreground">Covers payments, scheduling, reminders and support.</p></Card>
        <Card className="p-6"><p className="text-[13px] text-muted-foreground">Taxes</p><p className="mt-2 text-2xl font-semibold">{tax !== null ? `${tax}% GST` : '—'}</p><p className="mt-2 text-sm text-muted-foreground">{c?.pricing.taxBase === 'SUBTOTAL' ? 'Applied to the session price plus fee.' : 'Applied to the platform fee only.'}</p></Card>
      </div>
      {c && example && (
        <Card className="mt-8 p-6">
          <h2 className="font-semibold">Example: 60 minutes with a ₹1,000/hour teacher</h2>
          <dl className="mt-4 max-w-sm space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Session</dt><dd>{inr(example.price)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Platform fee ({fee}%)</dt><dd>{inr(example.fee)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">GST ({tax}%)</dt><dd>{inr(exTax)}</dd></div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold"><dt>You pay</dt><dd>{inr(example.price + example.fee + exTax)}</dd></div>
          </dl>
        </Card>
      )}
      <p className="mt-6 text-sm text-muted-foreground">
        Refunds follow our <Link href="/legal/cancellation" className="text-accent underline-offset-4 hover:underline">cancellation policy</Link>. Payments are processed by Razorpay; TeachMe never sees or stores your card details.
      </p>
      <Button asChild className="mt-8" size="lg"><Link href="/teachers">Browse teachers</Link></Button>
    </div>
  );
}
