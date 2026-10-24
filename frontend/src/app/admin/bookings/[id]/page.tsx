'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { Card, CardHeader, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { PriceSummary } from '@/features/booking/price-summary';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { meetingService } from '@/services/bookings';
import { adminService } from '@/services/admin';
import { formatDateTime, formatMoney, formatRange, STATUS_LABEL } from '@/utils/format';

export default function AdminBookingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { timezone } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'booking', id], queryFn: () => adminService.booking(id) });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [percent, setPercent] = useState('100');
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'booking', id] });
  const cancel = useMutation({ mutationFn: () => adminService.cancelBooking(id, reason, Number(percent)), onSuccess: () => { toast.success('Booking cancelled; refund queued if applicable'); setOpen(false); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const retryMeet = useMutation({ mutationFn: () => meetingService.retry(id), onSuccess: () => { toast.success('Meeting creation re-queued'); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  const b = q.data;
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  return (
    <>
      <Link href="/admin/bookings" className="text-[13px] text-muted-foreground hover:text-foreground">← Bookings</Link>
      <PageHeader title={`${b.subject.name}: ${b.student.name} → ${b.teacher.name}`} description={formatRange(b.startAt, b.endAt, timezone)} actions={
        <>
          {b.status === 'CONFIRMED' && b.meeting?.status !== 'READY' && <Button variant="secondary" loading={retryMeet.isPending} onClick={() => retryMeet.mutate()}>Retry Meet</Button>}
          {b.status === 'CONFIRMED' && <Button variant="danger" onClick={() => setOpen(true)}>Cancel with refund</Button>}
        </>
      } />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="State" action={<StatusBadge status={b.status} label={STATUS_LABEL[b.status]} />} />
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 p-5 text-sm">
            <dt className="text-muted-foreground">Booking id</dt><dd className="font-mono text-[12px]">{b.id}</dd>
            <dt className="text-muted-foreground">Meeting</dt><dd>{b.meeting ? <><StatusBadge status={b.meeting.status} /> {b.meeting.lastError && <span className="text-[12px] text-danger">{b.meeting.lastError}</span>}</> : '—'}</dd>
            <dt className="text-muted-foreground">Calendar</dt><dd>{b.calendar ? <><StatusBadge status={b.calendar.status} /> {b.calendar.lastError && <span className="text-[12px] text-danger">{b.calendar.lastError}</span>}</> : '—'}</dd>
            <dt className="text-muted-foreground">Reschedules</dt><dd>{b.rescheduleCount}</dd>
            {b.cancellationReason && <><dt className="text-muted-foreground">Cancellation</dt><dd>{b.cancellationReason}</dd></>}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Money" />
          <div className="space-y-4 p-5">
            <PriceSummary price={b.price} currency={b.price.currency} />
            {b.payment && (
              <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Payment</dt><dd><StatusBadge status={b.payment.status} /></dd>
                <dt className="text-muted-foreground">Razorpay order</dt><dd className="font-mono text-[12px]">{b.payment.providerOrderId}</dd>
                <dt className="text-muted-foreground">Razorpay payment</dt><dd className="font-mono text-[12px]">{b.payment.providerPaymentId ?? '—'}</dd>
                {b.payment.discrepancy && <><dt className="text-danger">Discrepancy</dt><dd className="text-danger">{b.payment.discrepancy}</dd></>}
              </dl>
            )}
            {b.refunds.map((r) => <p key={r.id} className="text-sm">Refund {formatMoney(r.amountMinor)} · <StatusBadge status={r.status} /> · {r.reason}</p>)}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Status history" />
          <ol className="space-y-2 p-5 text-sm">
            {b.history?.map((h, i) => <li key={i} className="flex gap-3"><span className="w-44 shrink-0 text-muted-foreground">{formatDateTime(h.createdAt, timezone)}</span><span>{h.fromStatus ? `${STATUS_LABEL[h.fromStatus]} → ` : ''}{STATUS_LABEL[h.toStatus]}{h.reason && <span className="text-muted-foreground"> · {h.reason}</span>}</span></li>)}
          </ol>
        </Card>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title="Cancel booking as admin" description="Both parties are notified. The refund is submitted to Razorpay and tracked until processed."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Keep</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel booking</Button></>}>
        <div className="space-y-4">
          <Field label="Refund percentage" htmlFor="ad-pct" hint={`= ${formatMoney(Math.floor((b.price.totalMinor * pct) / 100))} of ${formatMoney(b.price.totalMinor)}`}><Input type="number" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} /></Field>
          <Field label="Reason (sent to both parties)" htmlFor="ad-reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Dialog>
    </>
  );
}
