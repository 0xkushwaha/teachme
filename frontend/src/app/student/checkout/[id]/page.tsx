'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Clock, CreditCard, Loader2, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { use, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Card, ErrorState, Skeleton } from '@/components/ui/primitives';
import { useCountdown } from '@/features/booking/countdown';
import { PolicyText, PriceSummary } from '@/features/booking/price-summary';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, errorMessage, newIdempotencyKey } from '@/lib/api';
import { loadRazorpay, openRazorpay } from '@/lib/razorpay';
import { bookingService, paymentService } from '@/services/bookings';
import type { Booking } from '@/types/api';
import { formatMoney, formatRange } from '@/utils/format';

type Phase = 'idle' | 'opening' | 'in-checkout' | 'verifying' | 'confirming' | 'conflict' | 'failed';

export default function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { timezone } = useAuth();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const orderKey = useRef(newIdempotencyKey('order'));

  // While confirming we poll: the webhook or reconciler may confirm slightly after the browser returns.
  const booking = useQuery({
    queryKey: ['booking', id],
    queryFn: () => bookingService.get(id),
    refetchInterval: (q) => (phase === 'confirming' && q.state.data?.status === 'PENDING_PAYMENT' ? 2500 : false),
  });
  const b = booking.data;
  const hold = useCountdown(b?.status === 'PENDING_PAYMENT' ? b.holdExpiresAt : null);

  const pay = useMutation({
    mutationFn: async () => {
      setFailure(null);
      setPhase('opening');
      const order = await paymentService.createOrder(id, orderKey.current);
      await loadRazorpay();
      const rzp = openRazorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountMinor,
        currency: order.currency,
        name: 'TeachMe',
        description: order.description,
        prefill: order.prefill,
        notes: { bookingId: id },
        theme: { color: '#4f46e5' },
        retry: { enabled: true, max_count: 3 },
        modal: { ondismiss: () => setPhase((p) => (p === 'in-checkout' ? 'idle' : p)), confirm_close: true },
        handler: async (resp) => {
          setPhase('verifying');
          try {
            const r = await paymentService.verify({ bookingId: id, ...resp });
            if (r.outcome === 'confirmed' || r.outcome === 'already_confirmed') {
              await qc.invalidateQueries({ queryKey: ['booking', id] });
              setPhase('idle');
            } else if (r.outcome === 'conflict_refunded') {
              setPhase('conflict');
              qc.invalidateQueries({ queryKey: ['booking', id] });
            } else if (r.outcome === 'failed') {
              setPhase('failed');
              setFailure('The payment was declined. You have not been charged for this attempt.');
            } else {
              setPhase('confirming');
              qc.invalidateQueries({ queryKey: ['booking', id] });
            }
          } catch (err) {
            // Signature or network problem: never assume success. The webhook may still confirm it.
            setPhase('confirming');
            toast.error(errorMessage(err, 'We could not verify the payment yet. We’ll keep checking.'));
          }
        },
      });
      rzp.on('payment.failed', (r) => {
        const reason = r.error?.description ?? 'Payment failed';
        setFailure(reason);
        paymentService.clientFailure(id, reason).catch(() => undefined);
      });
      setPhase('in-checkout');
      rzp.open();
    },
    onError: (err) => {
      setPhase('idle');
      if (err instanceof ApiError && err.code === 'BOOKING_INVALID_STATE') qc.invalidateQueries({ queryKey: ['booking', id] });
      setFailure(errorMessage(err));
    },
  });

  if (booking.isError) return <ErrorState message={errorMessage(booking.error)} onRetry={() => booking.refetch()} />;
  if (!b) return <Skeleton className="h-96 rounded-2xl" />;

  const confirmed = b.status === 'CONFIRMED' || b.status === 'COMPLETED';
  const refunded = b.refunds.length > 0;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-6">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-accent">Checkout</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{confirmed ? 'You’re booked' : 'Confirm and pay'}</h1>
        </div>

        {confirmed ? (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
            <Card className="p-6">
              <CheckCircle2 className="size-10 text-success" />
              <h2 className="mt-4 text-lg font-semibold">Payment verified — session confirmed</h2>
              <p className="mt-1 text-sm text-muted-foreground">A confirmation email is on its way. Your Google Meet link appears on the booking as soon as your teacher’s calendar creates it.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild><Link href={`/student/sessions/${b.id}`}>View booking</Link></Button>
                <Button asChild variant="secondary"><a href={bookingService.icsUrl(b.id)}>Add to calendar (.ics)</a></Button>
              </div>
            </Card>
          </motion.div>
        ) : b.status === 'PENDING_PAYMENT' && !hold.expired ? (
          <Card className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-warning-soft text-warning"><Clock className="size-5" /></span>
                <div>
                  <p className="font-medium">Slot reserved for you</p>
                  <p className="text-[13px] text-muted-foreground">Complete payment before the timer ends.</p>
                </div>
              </div>
              <span className="font-mono text-2xl font-semibold tabular-nums" aria-live="off" aria-label={`${hold.label} remaining`}>{hold.label}</span>
            </div>
            {failure && <Alert tone="danger" className="mt-5" title="Payment not completed">{failure}</Alert>}
            {phase === 'confirming' ? (
              <div className="mt-6 flex items-center gap-3 rounded-xl bg-surface-2 p-4 text-sm"><Loader2 className="size-4 animate-spin text-accent" />Confirming your payment with Razorpay… this usually takes a few seconds. Don’t pay again.</div>
            ) : phase === 'verifying' ? (
              <div className="mt-6 flex items-center gap-3 rounded-xl bg-surface-2 p-4 text-sm"><Loader2 className="size-4 animate-spin text-accent" />Verifying payment…</div>
            ) : (
              <Button size="lg" className="mt-6 w-full" onClick={() => pay.mutate()} loading={phase === 'opening' || phase === 'in-checkout'}>
                <CreditCard /> Pay {formatMoney(b.price.totalMinor, b.price.currency)}
              </Button>
            )}
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground"><ShieldCheck className="size-3.5" />Secured by Razorpay · UPI, cards, netbanking</p>
            <button className="mt-4 w-full text-center text-[13px] text-muted-foreground hover:text-foreground" onClick={async () => { await bookingService.cancel(b.id, 'Checkout abandoned').catch(() => undefined); qc.invalidateQueries({ queryKey: ['booking', id] }); }}>
              Release this slot
            </button>
          </Card>
        ) : (
          <Card className="p-6">
            <XCircle className="size-9 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">{phase === 'conflict' || refunded ? 'Payment received after the slot was released' : 'This reservation has ended'}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {refunded
                ? `We couldn’t confirm this time, so a full refund of ${formatMoney(b.refunds[0].amountMinor)} has been started (${b.refunds[0].status.toLowerCase()}). Banks usually credit it in 5–7 working days.`
                : b.status === 'CANCELLED'
                  ? 'You released this slot. No payment was taken.'
                  : 'The hold expired before payment completed. No payment was taken — pick a time again.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild><Link href={`/teachers/${b.teacher.slug}`}><RotateCcw />Choose another time</Link></Button>
              {refunded && <Button asChild variant="secondary"><Link href={`/contact?category=PAYMENT&bookingId=${b.id}`}>Contact support</Link></Button>}
            </div>
          </Card>
        )}
      </div>

      <Summary b={b} timezone={timezone} />
    </div>
  );
}

function Summary({ b, timezone }: { b: Booking; timezone: string }) {
  return (
    <Card className="h-fit p-6 lg:sticky lg:top-24">
      <div className="flex items-center gap-3">
        <Avatar name={b.teacher.name} src={b.teacher.avatarUrl} />
        <div>
          <p className="font-medium">{b.subject.name}</p>
          <p className="text-[13px] text-muted-foreground">with {b.teacher.name}</p>
        </div>
      </div>
      <p className="mt-4 flex items-center gap-2 text-sm"><CalendarClock className="size-4 text-muted-foreground" />{formatRange(b.startAt, b.endAt, timezone)}</p>
      <div className="mt-5 border-t border-border pt-5">
        <PriceSummary price={b.price} currency={b.price.currency} />
      </div>
      <div className="mt-5 border-t border-border pt-5">
        <p className="mb-2 text-[13px] font-medium">Cancellation policy</p>
        <PolicyText policy={b.policy} />
      </div>
    </Card>
  );
}
