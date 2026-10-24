import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterForm } from '@/features/auth/register-form';

export const metadata: Metadata = { title: 'Create an account' };
export default function Page() {
  return <Suspense><RegisterForm /></Suspense>;
}
