'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/primitives';
import { AuthCard } from '@/features/auth/auth-card';
import { errorMessage } from '@/lib/api';
import { authService } from '@/services/auth';

const schema = z.object({ email: z.string().trim().email('Enter a valid email') });

export default function ForgotPassword() {
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const send = useMutation({ mutationFn: (email: string) => authService.forgotPassword(email.toLowerCase()) });
  if (send.isSuccess)
    return (
      <AuthCard title="Check your email" footer={<Link href="/login" className="text-accent hover:underline">Back to log in</Link>}>
        <MailCheck className="mb-4 size-8 text-accent" />
        <p className="text-sm text-muted-foreground">If an account exists for <strong className="text-foreground">{form.getValues('email')}</strong>, we’ve sent a reset link. It expires in 1 hour.</p>
      </AuthCard>
    );
  return (
    <AuthCard title="Reset your password" description="Enter your account email and we’ll send you a reset link." footer={<Link href="/login" className="text-accent hover:underline">Back to log in</Link>}>
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => send.mutate(v.email))} noValidate>
        {send.isError && <Alert tone="danger">{errorMessage(send.error)}</Alert>}
        <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}><Input type="email" autoComplete="email" autoFocus {...form.register('email')} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={send.isPending}>Send reset link</Button>
      </form>
    </AuthCard>
  );
}
