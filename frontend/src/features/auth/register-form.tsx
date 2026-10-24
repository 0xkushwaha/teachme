'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { BookOpen, Presentation } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/primitives';
import { homeFor, useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { authService } from '@/services/auth';
import { cn } from '@/utils/cn';
import { browserTimezone } from '@/utils/format';
import { AuthCard, safeNext } from './auth-card';

export const passwordRule = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lower-case letter')
  .regex(/[A-Z]/, 'Include an upper-case letter')
  .regex(/\d/, 'Include a number');

const schema = z.object({
  role: z.enum(['STUDENT', 'TEACHER']),
  fullName: z.string().trim().min(2, 'Enter your full name').max(100),
  email: z.string().trim().email('Enter a valid email'),
  password: passwordRule,
  acceptTerms: z.literal(true, { message: 'Please accept the terms to continue' }),
});
type Values = z.infer<typeof schema>;

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { setUser } = useAuth();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { role: params.get('role') === 'TEACHER' ? 'TEACHER' : 'STUDENT' } });
  const role = form.watch('role');
  const register = useMutation({
    mutationFn: (v: Values) => authService.register({ ...v, email: v.email.toLowerCase(), timezone: browserTimezone() }),
    onSuccess: (user) => {
      setUser(user);
      router.replace(user.role === 'TEACHER' ? '/teacher/profile?welcome=1' : safeNext(params.get('next'), homeFor(user.role)));
    },
  });
  const e = form.formState.errors;
  const roles = [
    { value: 'STUDENT' as const, label: 'I want to learn', icon: BookOpen },
    { value: 'TEACHER' as const, label: 'I want to teach', icon: Presentation },
  ];
  return (
    <AuthCard title="Create your account" description="It takes under a minute." footer={<>Already have an account? <Link href="/login" className="font-medium text-accent hover:underline">Log in</Link></>}>
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => register.mutate(v))} noValidate>
        {register.isError && <Alert tone="danger">{errorMessage(register.error)}</Alert>}
        <fieldset>
          <legend className="sr-only">Account type</legend>
          <div className="grid grid-cols-2 gap-2">
            {roles.map((r) => (
              <label key={r.value} className={cn('flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border p-3 text-[13px] font-medium transition-colors', role === r.value ? 'border-accent bg-accent-soft text-accent' : 'border-border hover:border-border-strong')}>
                <input type="radio" value={r.value} className="sr-only" {...form.register('role')} />
                <r.icon className="size-5" />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        {role === 'TEACHER' && <p className="text-[13px] text-muted-foreground">Teacher profiles are reviewed by our team before students can book them.</p>}
        <Field label="Full name" htmlFor="fullName" error={e.fullName?.message}><Input autoComplete="name" {...form.register('fullName')} /></Field>
        <Field label="Email" htmlFor="email" error={e.email?.message}><Input type="email" autoComplete="email" {...form.register('email')} /></Field>
        <Field label="Password" htmlFor="password" error={e.password?.message} hint="10+ characters with upper case, lower case and a number"><Input type="password" autoComplete="new-password" {...form.register('password')} /></Field>
        <div>
          <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
            <Checkbox className="mt-0.5" aria-invalid={!!e.acceptTerms} {...form.register('acceptTerms')} />
            <span>I agree to the <Link href="/legal/terms" target="_blank" className="text-accent hover:underline">Terms of service</Link> and <Link href="/legal/privacy" target="_blank" className="text-accent hover:underline">Privacy policy</Link>.</span>
          </label>
          {e.acceptTerms && <p role="alert" className="mt-1 text-[12.5px] text-danger">{e.acceptTerms.message}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={register.isPending}>Create account</Button>
      </form>
    </AuthCard>
  );
}
