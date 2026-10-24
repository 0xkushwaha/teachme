import { Mail } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/ui/primitives';
import { ContactForm } from '@/features/support/contact-form';

export const metadata: Metadata = { title: 'Contact support' };

export default function ContactPage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_1.5fr]">
      <div>
        <PageHeader eyebrow="Support" title="How can we help?" description="Report a booking problem, ask about a payment, or get help with your account." />
        <ul className="space-y-4 text-sm text-muted-foreground">
          <li className="flex gap-3"><Mail className="mt-0.5 size-4 text-accent" />Replies come by email, usually within one working day.</li>
          <li>For a booking issue, include the booking reference from the booking page so we can find it straight away.</li>
          <li>Never share card numbers, OTPs or passwords with anyone — including us.</li>
        </ul>
      </div>
      <Suspense><ContactForm /></Suspense>
    </div>
  );
}
