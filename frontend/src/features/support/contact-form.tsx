'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Card } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { supportService } from '@/services/account';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name'),
  email: z.string().trim().email('Enter a valid email'),
  category: z.enum(['BOOKING_ISSUE', 'PAYMENT', 'TECHNICAL', 'ACCOUNT', 'TEACHER_APPLICATION', 'OTHER']),
  subject: z.string().trim().min(4, 'Add a short subject').max(140),
  message: z.string().trim().min(10, 'Tell us a bit more (at least 10 characters)').max(4000),
  bookingId: z.string().uuid('Booking reference should look like a long ID from your booking page').optional().or(z.literal('')),
});
type Values = z.infer<typeof schema>;

export function ContactForm() {
  const { user } = useAuth();
  const params = useSearchParams();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { category: (params.get('category') as Values['category']) ?? 'OTHER', bookingId: params.get('bookingId') ?? '' } });
  useEffect(() => {
    if (user) form.reset({ ...form.getValues(), name: user.fullName, email: user.email });
  }, [user, form]);
  const submit = useMutation({ mutationFn: (v: Values) => supportService.create({ ...v, bookingId: v.bookingId || undefined }) });
  const e = form.formState.errors;

  if (submit.isSuccess) {
    return (
      <Card className="p-8 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <h2 className="mt-4 text-lg font-semibold">We’ve got your message</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ticket reference <span className="font-mono">{submit.data.id.slice(0, 8)}</span>. We reply by email, usually within one working day.</p>
      </Card>
    );
  }
  return (
    <Card className="p-6">
      <form onSubmit={form.handleSubmit((v) => submit.mutate(v))} className="space-y-4" noValidate>
        {submit.isError && <Alert tone="danger">{errorMessage(submit.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="c-name" error={e.name?.message}><Input autoComplete="name" {...form.register('name')} /></Field>
          <Field label="Email" htmlFor="c-email" error={e.email?.message}><Input type="email" autoComplete="email" {...form.register('email')} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Topic" htmlFor="c-cat"><Select {...form.register('category')}>
            <option value="BOOKING_ISSUE">Problem with a booking</option>
            <option value="PAYMENT">Payment or refund</option>
            <option value="TECHNICAL">Technical issue</option>
            <option value="ACCOUNT">Account</option>
            <option value="TEACHER_APPLICATION">Teaching on TeachMe</option>
            <option value="OTHER">Something else</option>
          </Select></Field>
          <Field label="Booking reference (optional)" htmlFor="c-booking" error={e.bookingId?.message}><Input {...form.register('bookingId')} placeholder="From your booking page" /></Field>
        </div>
        <Field label="Subject" htmlFor="c-subject" error={e.subject?.message}><Input {...form.register('subject')} /></Field>
        <Field label="Message" htmlFor="c-message" error={e.message?.message}><Textarea rows={6} {...form.register('message')} /></Field>
        <Button type="submit" loading={submit.isPending}>Send message</Button>
      </form>
    </Card>
  );
}
