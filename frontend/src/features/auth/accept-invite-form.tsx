'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { Alert, Skeleton } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { authService } from '@/services/auth';
import { browserTimezone, formatDateTime } from '@/utils/format';
import { AuthCard } from './auth-card';
import { passwordRule } from './register-form';

const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(100),
  password: passwordRule,
  acceptTerms: z.literal(true, { message: 'Please accept the terms to continue' }),
});
type Values = z.infer<typeof schema>;

export function AcceptInviteForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const { setUser } = useAuth();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => authService.inspectInvitation(token), enabled: token.length >= 20, retry: false });
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const accept = useMutation({
    mutationFn: (v: Values) => authService.acceptInvitation({ token, ...v, timezone: browserTimezone() }),
    onSuccess: (user) => {
      setUser(user);
      router.replace('/teacher/application?welcome=1');
    },
  });
  const e = form.formState.errors;

  if (token.length < 20 || invite.isError) {
    return (
      <AuthCard title="Invitation unavailable" footer={<>Already have an account? <Link href="/login" className="font-medium text-accent hover:underline">Log in</Link></>}>
        <Alert tone="danger" title="This invitation link can't be used">
          {invite.isError ? errorMessage(invite.error) : 'The link is incomplete.'} Ask the TeachMe team to send you a new invitation.
        </Alert>
      </AuthCard>
    );
  }
  if (!invite.data) return <Skeleton className="h-[420px] rounded-2xl" />;

  return (
    <AuthCard
      title="Join TeachMe as a teacher"
      description={<>You were invited as <strong className="text-foreground">{invite.data.email}</strong>. This link expires {formatDateTime(invite.data.expiresAt, browserTimezone())}.</>}
      footer={<>Already have an account? <Link href="/login" className="font-medium text-accent hover:underline">Log in</Link></>}
    >
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => accept.mutate(v))} noValidate>
        {accept.isError && <Alert tone="danger">{errorMessage(accept.error)}</Alert>}
        <Field label="Email" htmlFor="invite-email" hint="Set by your invitation"><Input value={invite.data.email} readOnly disabled /></Field>
        <Field label="Full name" htmlFor="fullName" error={e.fullName?.message}><Input autoComplete="name" {...form.register('fullName')} /></Field>
        <Field label="Password" htmlFor="password" error={e.password?.message} hint="10+ characters with upper case, lower case and a number"><Input type="password" autoComplete="new-password" {...form.register('password')} /></Field>
        <div>
          <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
            <Checkbox className="mt-0.5" aria-invalid={!!e.acceptTerms} {...form.register('acceptTerms')} />
            <span>I agree to the <Link href="/legal/terms" target="_blank" className="text-accent hover:underline">Terms of service</Link> and <Link href="/legal/privacy" target="_blank" className="text-accent hover:underline">Privacy policy</Link>.</span>
          </label>
          {e.acceptTerms && <p role="alert" className="mt-1 text-[12.5px] text-danger">{e.acceptTerms.message}</p>}
        </div>
        <p className="text-[13px] text-muted-foreground">Next you&apos;ll complete your profile and upload your qualifications. Our team reviews every application before students can book you.</p>
        <Button type="submit" size="lg" className="w-full" loading={accept.isPending}>Create teacher account</Button>
      </form>
    </AuthCard>
  );
}
