'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/primitives';
import { AuthCard } from '@/features/auth/auth-card';
import { passwordRule } from '@/features/auth/register-form';
import { errorMessage } from '@/lib/api';
import { authService } from '@/services/auth';

const schema = z.object({ password: passwordRule, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords don’t match' });

function Reset() {
  const token = useSearchParams().get('token');
  const router = useRouter();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const reset = useMutation({ mutationFn: (p: string) => authService.resetPassword(token!, p), onSuccess: () => router.replace('/login?reset=1') });
  if (!token) return <AuthCard title="Missing reset link" description="Open the link from your email, or request a new one."><Button asChild className="w-full"><Link href="/forgot-password">Request a new link</Link></Button></AuthCard>;
  const e = form.formState.errors;
  return (
    <AuthCard title="Choose a new password" description="This signs you out on all other devices.">
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => reset.mutate(v.password))} noValidate>
        {reset.isError && <Alert tone="danger" title="Couldn’t reset password">{errorMessage(reset.error)} <Link href="/forgot-password" className="underline">Request a new link</Link>.</Alert>}
        <Field label="New password" htmlFor="password" error={e.password?.message} hint="10+ characters with upper case, lower case and a number"><Input type="password" autoComplete="new-password" autoFocus {...form.register('password')} /></Field>
        <Field label="Confirm password" htmlFor="confirm" error={e.confirm?.message}><Input type="password" autoComplete="new-password" {...form.register('confirm')} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={reset.isPending}>Update password</Button>
      </form>
    </AuthCard>
  );
}

export default function Page() {
  return <Suspense><Reset /></Suspense>;
}
