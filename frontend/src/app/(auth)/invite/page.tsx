import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AcceptInviteForm } from '@/features/auth/accept-invite-form';

export const metadata: Metadata = { title: 'Accept teacher invitation', robots: { index: false } };
export default function Page() {
  return <Suspense><AcceptInviteForm /></Suspense>;
}
