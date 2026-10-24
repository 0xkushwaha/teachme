'use client';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/primitives';
import { AuthCard } from '@/features/auth/auth-card';
import { homeFor, useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { authService } from '@/services/auth';

function Verify() {
  const token = useSearchParams().get('token');
  const { user, refresh } = useAuth();
  const verify = useMutation({ mutationFn: (t: string) => authService.verifyEmail(t), onSuccess: () => refresh() });
  const started = useRef(false);
  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  if (!token) return <AuthCard title="Check your inbox" description="Open the verification link we emailed you to activate booking."><Button asChild variant="secondary" className="w-full"><Link href="/login">Back to log in</Link></Button></AuthCard>;
  if (verify.isPending || verify.isIdle) return <AuthCard title="Verifying your email…"><Spinner label="Verifying" /></AuthCard>;
  if (verify.isError)
    return (
      <AuthCard title="This link didn’t work" description={errorMessage(verify.error)}>
        <XCircle className="mb-4 size-8 text-danger" />
        <p className="text-sm text-muted-foreground">Links expire after 24 hours and work once. Log in and use “Resend email” from your dashboard to get a new one.</p>
        <Button asChild className="mt-5 w-full"><Link href={user ? homeFor(user.role) : '/login'}>{user ? 'Go to dashboard' : 'Log in'}</Link></Button>
      </AuthCard>
    );
  return (
    <AuthCard title="Email verified">
      <CheckCircle2 className="mb-4 size-9 text-success" />
      <p className="text-sm text-muted-foreground">You’re all set — you can now book sessions.</p>
      <Button asChild className="mt-5 w-full"><Link href={user ? homeFor(user.role) : '/login'}>{user ? 'Continue to dashboard' : 'Log in'}</Link></Button>
    </AuthCard>
  );
}

export default function Page() {
  return <Suspense><Verify /></Suspense>;
}
