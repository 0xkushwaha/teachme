'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/primitives';
import { homeFor, useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { authService } from '@/services/auth';
import { AuthCard, safeNext } from './auth-card';

const schema = z.object({ email: z.string().trim().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') });
type Values = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { setUser } = useAuth();
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const login = useMutation({
    mutationFn: (v: Values) => authService.login(v.email.toLowerCase(), v.password),
    onSuccess: (user) => {
      setUser(user);
      router.replace(safeNext(params.get('next'), homeFor(user.role)));
    },
  });
  const e = form.formState.errors;
  return (
    <AuthCard title="Welcome back" description="Log in to manage your sessions." footer={<>New to TeachMe? <Link href="/register" className="font-medium text-accent hover:underline">Create an account</Link></>}>
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate>
        {params.get('reset') && <Alert tone="success">Password updated. Log in with your new password.</Alert>}
        {login.isError && <Alert tone="danger">{errorMessage(login.error)}</Alert>}
        <Field label="Email" htmlFor="email" error={e.email?.message}><Input type="email" autoComplete="email" autoFocus {...form.register('email')} /></Field>
        <Field label="Password" htmlFor="password" error={e.password?.message}><Input type="password" autoComplete="current-password" {...form.register('password')} /></Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-[13px] text-accent hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={login.isPending}>Log in</Button>
      </form>
    </AuthCard>
  );
}
