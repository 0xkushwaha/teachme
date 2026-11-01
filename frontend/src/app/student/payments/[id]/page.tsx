'use client';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card, ErrorState, Skeleton } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { studentPaymentService } from '@/services/account';
import { formatDate, formatDateTime, formatMoney } from '@/utils/format';

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['student', 'receipt', id], queryFn: () => studentPaymentService.receipt(id) });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="mx-auto h-[560px] max-w-2xl rounded-2xl" />;
  const r = q.data;
  const zone = r.session.timezone;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/student/payments" className="text-[13px] text-muted-foreground hover:text-foreground">← All payments</Link>
        <Button variant="secondary" onClick={() => window.print()}><Printer />Print or save as PDF</Button>
      </div>
      <Card className="p-8 print:border-0 print:shadow-none">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <Logo href="/student" />
            <p className="mt-3 text-[13px] text-muted-foreground">Payment receipt</p>
          </div>
          <dl className="text-sm sm:text-right">
            <dt className="text-[12px] text-muted-foreground">Receipt no.</dt>
            <dd className="font-mono font-medium">{r.receiptNumber}</dd>
            <dt className="mt-2 text-[12px] text-muted-foreground">Date</dt>
            <dd>{formatDate(r.issuedAt, zone)}</dd>
          </dl>
        </div>

        <div className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <p className="text-[12px] text-muted-foreground">Billed to</p>
            <p className="font-medium">{r.billedTo.name}</p>
            <p className="text-muted-foreground">{r.billedTo.email}</p>
          </div>
          <div>
            <p className="text-[12px] text-muted-foreground">Session</p>
            <p className="font-medium">{r.session.subject} with {r.session.teacher}</p>
            <p className="text-muted-foreground">{formatDateTime(r.session.startAt, zone)} · {r.session.durationMinutes} min</p>
          </div>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead><tr className="border-b border-border text-left text-[12px] uppercase tracking-wide text-muted-foreground"><th className="py-2 font-medium">Description</th><th className="py-2 text-right font-medium">Amount</th></tr></thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.label} className="border-b border-border"><td className="py-2.5">{l.label}</td><td className="py-2.5 text-right tabular-nums">{formatMoney(l.amountMinor, r.currency)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td className="pt-3 font-semibold">Total paid</td><td className="pt-3 text-right font-semibold tabular-nums">{formatMoney(r.paidMinor, r.currency)}</td></tr>
            {r.refundedMinor > 0 && (
              <>
                <tr><td className="pt-1 text-muted-foreground">Refunded</td><td className="pt-1 text-right tabular-nums text-muted-foreground">−{formatMoney(r.refundedMinor, r.currency)}</td></tr>
                <tr><td className="pt-1 font-semibold">Net paid</td><td className="pt-1 text-right font-semibold tabular-nums">{formatMoney(r.netPaidMinor, r.currency)}</td></tr>
              </>
            )}
          </tfoot>
        </table>

        <p className="mt-8 text-[12.5px] text-muted-foreground">
          Paid via {r.provider === 'RAZORPAY' ? 'Razorpay' : r.provider}{r.method ? ` (${r.method})` : ''}{r.providerPaymentId ? ` · payment ID ${r.providerPaymentId}` : ''}. Booking reference {r.session.bookingId.slice(0, 8).toUpperCase()}.
          This receipt confirms payment for the session above; it is not a tax invoice.
        </p>
      </Card>
    </div>
  );
}
