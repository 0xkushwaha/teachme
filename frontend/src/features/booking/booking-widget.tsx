'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Lock } from 'lucide-react';
import { DateTime } from 'luxon';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label, Select, Textarea } from '@/components/ui/form';
import { Alert, Card, Skeleton } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, errorMessage, newIdempotencyKey } from '@/lib/api';
import { bookingService } from '@/services/bookings';
import { catalogService } from '@/services/catalog';
import type { Slot, TeacherProfile } from '@/types/api';
import { PolicyText, PriceSummary, taxLabelFor } from './price-summary';
import { SlotPicker } from './slot-picker';

export function BookingWidget({ teacher, initialSubject }: { teacher: TeacherProfile; initialSubject?: string }) {
  const { user, timezone } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [subjectId, setSubjectId] = useState(teacher.subjects.find((s) => s.slug === initialSubject)?.id ?? teacher.subjects[0]?.id ?? '');
  const [duration, setDuration] = useState(teacher.sessionDurations.includes(60) ? 60 : teacher.sessionDurations[0]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [note, setNote] = useState('');
  // One idempotency key per distinct booking attempt; a double-click or network retry reuses it.
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const quote = useQuery({ queryKey: ['public', 'quote', teacher.id, subjectId, duration], queryFn: () => catalogService.quote(teacher.id, subjectId, duration), enabled: !!subjectId });

  const reserve = useMutation({
    mutationFn: async () => {
      const body = { teacherId: teacher.id, subjectId, startAt: slot!.startAt, durationMinutes: duration, note: note.trim() || undefined };
      const fingerprint = JSON.stringify(body);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: newIdempotencyKey('book') };
      return bookingService.create(body, attempt.current.key);
    },
    onSuccess: (b) => router.push(`/student/checkout/${b.id}`),
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SLOT_UNAVAILABLE') {
        setSlot(null);
        attempt.current = null;
        qc.invalidateQueries({ queryKey: ['slots', teacher.id] });
      }
      toast.error(errorMessage(err));
    },
  });

  const proceed = () => {
    if (!user) {
      const back = `/teachers/${teacher.slug}?subject=${teacher.subjects.find((s) => s.id === subjectId)?.slug ?? ''}`;
      router.push(`/login?next=${encodeURIComponent(back)}`);
      return;
    }
    reserve.mutate();
  };

  const blocker =
    user && user.role !== 'STUDENT'
      ? 'Bookings are made from a student account.'
      : user && !user.emailVerified
        ? 'Verify your email address before booking — check your inbox for the link.'
        : null;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-semibold tracking-tight">Book a session</h2>
        <p className="text-[13px] text-muted-foreground">Choose a subject, length and time.</p>
      </div>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bw-subject">Subject</Label>
            <Select id="bw-subject" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setSlot(null); }}>
              {teacher.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bw-duration">Length</Label>
            <Select id="bw-duration" value={duration} onChange={(e) => { setDuration(Number(e.target.value)); setSlot(null); }}>
              {teacher.sessionDurations.map((d) => <option key={d} value={d}>{d} minutes</option>)}
            </Select>
          </div>
        </div>

        <SlotPicker teacherId={teacher.id} durationMinutes={duration} timezone={timezone} selected={slot?.startAt ?? null} onSelect={setSlot} maxAdvanceDays={teacher.maxAdvanceDays} />

        {slot && (
          <div className="space-y-1.5">
            <Label htmlFor="bw-note">Anything your teacher should know? (optional)</Label>
            <Textarea id="bw-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Chapter 7, rotational motion — I struggle with torque problems." />
          </div>
        )}

        <div className="rounded-xl bg-surface-2 p-4">
          {quote.isLoading ? (
            <Skeleton className="h-24" />
          ) : quote.data ? (
            <>
              {slot && (
                <p className="mb-3 text-sm font-medium">
                  {DateTime.fromISO(slot.startAt).setZone(timezone).toFormat("cccc, d LLLL '·' h:mm a")} · {duration} min
                </p>
              )}
              <PriceSummary price={quote.data} currency={quote.data.currency} taxLabel={taxLabelFor(quote.data)} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Price unavailable.</p>
          )}
        </div>

        {blocker && <Alert tone="warning">{blocker}</Alert>}

        <Button size="lg" className="w-full" disabled={!slot || !!blocker} loading={reserve.isPending} onClick={proceed}>
          {user ? 'Reserve & continue to payment' : 'Log in to book'} <ArrowRight />
        </Button>
        <p className="flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground">
          <Lock className="size-3" /> Your slot is held for {quote.data?.holdMinutes ?? 10} minutes while you pay.
        </p>
        {quote.data && (
          <details className="group rounded-xl border border-border px-4 py-3">
            <summary className="cursor-pointer text-[13px] font-medium">Cancellation & reschedule policy</summary>
            <div className="mt-2">
              <PolicyText policy={quote.data.policy} />
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}
