import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/primitives';
import { Reveal } from '@/components/motion/reveal';

export const metadata: Metadata = { title: 'How it works' };

const STUDENT = [
  ['Find a teacher', 'Browse by subject or search. Every profile shows qualifications, languages, hourly rate and live availability.'],
  ['Choose a time', 'Pick a slot in your own timezone. We reserve it for you for a few minutes while you pay — nobody else can take it.'],
  ['Pay securely', 'Pay with UPI, card or netbanking via Razorpay. Your booking is confirmed only once our server verifies the payment with Razorpay.'],
  ['Get your Meet link', 'Your teacher’s Google Calendar creates the session and a Google Meet link, which appears on your booking and in your email.'],
  ['Get reminded', 'We email and notify you before the session (24 hours and 1 hour ahead by default).'],
  ['Change plans if you need to', 'Reschedule or cancel from the booking page. You always see the refund you’d receive before confirming.'],
];
const TEACHER = [
  ['Apply', 'Create a teacher account and complete your profile, subjects and rates. Our team reviews every application.'],
  ['Set your hours', 'Define weekly working hours, breaks, holidays, session lengths, buffer time and minimum notice.'],
  ['Connect Google Calendar', 'Sessions are added to your calendar with a Meet link automatically. We only request permission to manage events.'],
  ['Teach', 'See every upcoming session, the student’s goals and notes, and join from your dashboard.'],
];

function Steps({ items }: { items: string[][] }) {
  return (
    <ol className="relative space-y-6 border-l border-border pl-8">
      {items.map(([title, body], i) => (
        <Reveal key={title} delay={i * 0.04}>
          <li className="relative">
            <span className="absolute -left-[45px] grid size-7 place-items-center rounded-full border border-border bg-surface font-mono text-[12px] text-accent">{i + 1}</span>
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
          </li>
        </Reveal>
      ))}
    </ol>
  );
}

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <PageHeader eyebrow="How it works" title="Live lessons without the logistics" description="TeachMe handles scheduling, payments, calendar invites, Meet links and reminders so you can focus on learning." />
      <div className="grid gap-12 md:grid-cols-2">
        <section><h2 className="mb-6 text-lg font-semibold">For students</h2><Steps items={STUDENT} /></section>
        <section><h2 className="mb-6 text-lg font-semibold">For teachers</h2><Steps items={TEACHER} /></section>
      </div>
      <div className="mt-14 flex flex-wrap gap-3">
        <Button asChild size="lg"><Link href="/teachers">Find a teacher</Link></Button>
        <Button asChild size="lg" variant="secondary"><Link href="/register?role=TEACHER">Apply to teach</Link></Button>
      </div>
    </div>
  );
}
