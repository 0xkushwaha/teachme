'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CalendarPlus, Download, LifeBuoy, Loader2, RefreshCw, Video, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { Alert, Avatar, Card, CardHeader, ErrorState, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage, newIdempotencyKey } from '@/lib/api';
import { bookingService, meetingService } from '@/services/bookings';
import type { Booking, Slot } from '@/types/api';
import { formatDateTime, formatMoney, formatRange, relative, STATUS_LABEL } from '@/utils/format';
import { PolicyText, PriceSummary } from './price-summary';
import { estimateRefund, googleCalendarLink } from './refund-estimate';
import { SlotPicker } from './slot-picker';

type Viewer = 'student' | 'teacher';

export function BookingDetail({ id, viewer }: { id: string; viewer: Viewer }) {
  const { timezone } = useAuth();
  const q = useQuery({
    queryKey: ['booking', id],
    queryFn: () => bookingService.get(id),
    // Meet links are created asynchronously; poll briefly while pending.
    refetchInterval: (query) => (query.state.data?.status === 'CONFIRMED' && query.state.data.meeting?.status === 'PENDING' ? 8000 : false),
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  const b = q.data;
  const upcoming = b.status === 'CONFIRMED' && new Date(b.startAt).getTime() > Date.now();
  const other = viewer === 'student' ? { name: b.teacher.name, avatar: b.teacher.avatarUrl, label: 'Teacher' } : { name: b.student.name, avatar: null, label: 'Student' };
  const policy = b.policy.reschedule;
  const canReschedule = upcoming && b.rescheduleCount < policy.maxReschedules && (viewer === 'teacher' || new Date(b.startAt).getTime() - Date.now() >= policy.minHoursBefore * 3_600_000);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <div>
          <Link href={viewer === 'student' ? '/student/sessions' : '/teacher/bookings'} className="text-[13px] text-muted-foreground hover:text-foreground">← All sessions</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{b.subject.name}</h1>
            <StatusBadge status={b.status} label={STATUS_LABEL[b.status]} />
          </div>
          <p className="mt-1 flex items-center gap-2 text-muted-foreground"><CalendarClock className="size-4" />{formatRange(b.startAt, b.endAt, timezone)}{upcoming && <span>· {relative(b.startAt)}</span>}</p>
        </div>

        {b.status === 'CONFIRMED' && <MeetingPanel b={b} viewer={viewer} />}
        {b.status === 'CANCELLED' && (
          <Alert tone="info" title={`Cancelled ${b.cancelledAt ? relative(b.cancelledAt) : ''}`}>{b.cancellationReason ?? 'No reason given.'}</Alert>
        )}
        {(b.status === 'EXPIRED' || b.status === 'PAYMENT_FAILED') && <Alert tone="warning" title="This booking was not completed">{b.cancellationReason ?? 'Payment was not completed before the reservation expired.'}</Alert>}

        <Card>
          <CardHeader title="Session" />
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <Avatar name={other.name} src={other.avatar} />
              <div>
                <p className="text-[12px] text-muted-foreground">{other.label}</p>
                <p className="font-medium">{other.name}</p>
              </div>
              {viewer === 'student' && <Button asChild size="sm" variant="ghost" className="ml-auto"><Link href={`/teachers/${b.teacher.slug}`}>Profile</Link></Button>}
            </div>
            {viewer === 'teacher' && (b.student.gradeLevel || b.student.learningGoals) && (
              <dl className="grid gap-3 rounded-xl bg-surface-2 p-4 text-sm sm:grid-cols-2">
                {b.student.gradeLevel && <div><dt className="text-[12px] text-muted-foreground">Level</dt><dd>{b.student.gradeLevel}</dd></div>}
                {b.student.learningGoals && <div className="sm:col-span-2"><dt className="text-[12px] text-muted-foreground">Goals</dt><dd>{b.student.learningGoals}</dd></div>}
              </dl>
            )}
            {b.studentNote && (
              <div>
                <p className="text-[12px] text-muted-foreground">{viewer === 'student' ? 'Your note to the teacher' : 'Note from the student'}</p>
                <p className="mt-1 whitespace-pre-line text-sm">{b.studentNote}</p>
              </div>
            )}
            <p className="text-[13px] text-muted-foreground">{b.durationMinutes} minutes · rescheduled {b.rescheduleCount} of {policy.maxReschedules} times allowed</p>
          </div>
        </Card>

        {upcoming && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setRescheduleOpen(true)} disabled={!canReschedule} title={canReschedule ? undefined : 'Reschedule window has closed or limit reached'}>
              <RefreshCw />Reschedule
            </Button>
            <Button variant="secondary" className="text-danger" onClick={() => setCancelOpen(true)}><XCircle />Cancel session</Button>
            <Button asChild variant="ghost"><Link href={`/contact?category=BOOKING_ISSUE&bookingId=${b.id}`}><LifeBuoy />Report an issue</Link></Button>
          </div>
        )}
        {!upcoming && (
          <Button asChild variant="ghost"><Link href={`/contact?category=BOOKING_ISSUE&bookingId=${b.id}`}><LifeBuoy />Report an issue with this booking</Link></Button>
        )}

        {b.history && b.history.length > 0 && (
          <Card>
            <CardHeader title="Activity" />
            <ol className="space-y-3 p-5">
              {b.history.map((h, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
                  <div>
                    <p>{h.reason ?? STATUS_LABEL[h.toStatus]}</p>
                    <p className="text-[12px] text-muted-foreground">{formatDateTime(h.createdAt, timezone)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Payment" />
          <div className="space-y-4 p-5">
            {viewer === 'student' ? (
              <PriceSummary price={b.price} currency={b.price.currency} />
            ) : (
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Session price</span><span className="font-semibold tabular-nums">{formatMoney(b.price.priceMinor, b.price.currency)}</span></div>
            )}
            {b.payment && <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Payment status</span><StatusBadge status={b.payment.status} /></div>}
            {b.refunds.map((r) => (
              <div key={r.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex items-center justify-between"><span>Refund {formatMoney(r.amountMinor, b.price.currency)}</span><StatusBadge status={r.status} /></div>
                <p className="mt-1 text-[12px] text-muted-foreground">{r.status === 'PROCESSED' ? `Processed ${r.processedAt ? relative(r.processedAt) : ''}. Banks usually credit within 5–7 working days.` : r.status === 'FAILED' ? 'Our team has been alerted and will resolve this.' : 'Being processed by Razorpay.'}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="mb-2 text-[13px] font-medium">Policy for this booking</p>
          <PolicyText policy={b.policy} />
        </Card>
      </div>

      <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} b={b} viewer={viewer} />
      {rescheduleOpen && <RescheduleDialog open={rescheduleOpen} onOpenChange={setRescheduleOpen} b={b} />}
    </div>
  );
}

function MeetingPanel({ b, viewer }: { b: Booking; viewer: Viewer }) {
  const qc = useQueryClient();
  const retry = useMutation({ mutationFn: () => meetingService.retry(b.id), onSuccess: () => { toast.success('Retrying meeting creation…'); qc.invalidateQueries({ queryKey: ['booking', b.id] }); }, onError: (e) => toast.error(errorMessage(e)) });
  const m = b.meeting;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Video className="size-5" /></span>
        <div className="flex-1">
          {m?.status === 'READY' && m.joinUrl ? (
            <>
              <p className="font-medium">Google Meet is ready</p>
              <p className="break-all text-[13px] text-muted-foreground">{m.joinUrl}</p>
            </>
          ) : m?.status === 'FAILED' ? (
            <>
              <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4 text-danger" />Meeting link couldn’t be created</p>
              <p className="text-[13px] text-muted-foreground">{viewer === 'teacher' ? m.lastError ?? 'Google returned an error.' : 'Your teacher has been notified. You can also contact support.'}</p>
            </>
          ) : m?.status === 'NOT_CONFIGURED' ? (
            <>
              <p className="font-medium">Meeting link not available yet</p>
              <p className="text-[13px] text-muted-foreground">{viewer === 'teacher' ? <>Connect Google Calendar to create Meet links automatically. <Link className="text-accent underline" href="/teacher/integrations">Connect now</Link></> : 'Your teacher will share the joining details before the session. You’ll be notified.'}</p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 font-medium"><Loader2 className="size-4 animate-spin text-accent" />Creating your Google Meet link…</p>
              <p className="text-[13px] text-muted-foreground">This usually takes under a minute. We’ll email it when it’s ready.</p>
            </>
          )}
        </div>
        {m?.joinUrl && <Button asChild><a href={m.joinUrl} target="_blank" rel="noopener noreferrer"><Video />Join</a></Button>}
        {viewer === 'teacher' && (m?.status === 'FAILED' || m?.status === 'NOT_CONFIGURED') && <Button variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}><RefreshCw />Retry</Button>}
      </div>
      {viewer === 'student' && (
        <div className="flex flex-wrap gap-2 border-t border-border bg-surface-2/60 px-5 py-3">
          <Button asChild size="sm" variant="ghost"><a href={googleCalendarLink(b)} target="_blank" rel="noopener noreferrer"><CalendarPlus />Add to Google Calendar</a></Button>
          <Button asChild size="sm" variant="ghost"><a href={bookingService.icsUrl(b.id)}><Download />Download .ics</a></Button>
        </div>
      )}
    </Card>
  );
}

function CancelDialog({ open, onOpenChange, b, viewer }: { open: boolean; onOpenChange: (o: boolean) => void; b: Booking; viewer: Viewer }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const est = estimateRefund(b, viewer === 'teacher' ? 'TEACHER' : 'STUDENT');
  const cancel = useMutation({
    mutationFn: () => bookingService.cancel(b.id, reason.trim() || undefined),
    onSuccess: (r) => {
      toast.success(r.refund.refundMinor > 0 ? `Cancelled. Refund of ${formatMoney(r.refund.refundMinor)} started.` : 'Session cancelled.');
      qc.invalidateQueries({ queryKey: ['booking', b.id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cancel this session?"
      description={viewer === 'teacher' ? 'The student will be refunded in full and notified immediately.' : 'Refunds follow the policy saved with this booking.'}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Keep session</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel session</Button></>}
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="text-[13px] text-muted-foreground">{viewer === 'teacher' ? 'Student refund' : 'Estimated refund'}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(est.minor, b.price.currency)} <span className="text-sm font-normal text-muted-foreground">({est.percent}%)</span></p>
          <p className="mt-1 text-[12px] text-muted-foreground">The exact amount is confirmed when you cancel.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">Reason {viewer === 'teacher' ? '(shared with the student)' : '(optional)'}</Label>
          <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
      </div>
    </Dialog>
  );
}

function RescheduleDialog({ open, onOpenChange, b }: { open: boolean; onOpenChange: (o: boolean) => void; b: Booking }) {
  const { timezone } = useAuth();
  const qc = useQueryClient();
  const [slot, setSlot] = useState<Slot | null>(null);
  const key = useRef<{ start: string; key: string } | null>(null);
  const move = useMutation({
    mutationFn: () => {
      if (key.current?.start !== slot!.startAt) key.current = { start: slot!.startAt, key: newIdempotencyKey('resched') };
      return bookingService.reschedule(b.id, slot!.startAt, key.current.key);
    },
    onSuccess: () => {
      toast.success('Session rescheduled. Both of you have been notified.');
      qc.invalidateQueries({ queryKey: ['booking', b.id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
      onOpenChange(false);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      setSlot(null);
      qc.invalidateQueries({ queryKey: ['slots', b.teacher.id] });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Pick a new time"
      description={`Currently ${formatRange(b.startAt, b.endAt, timezone)}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button><Button disabled={!slot} loading={move.isPending} onClick={() => move.mutate()}>Move session</Button></>}
    >
      <SlotPicker teacherId={b.teacher.id} durationMinutes={b.durationMinutes} timezone={timezone} selected={slot?.startAt ?? null} onSelect={setSlot} excludeStart={b.startAt} />
    </Dialog>
  );
}
