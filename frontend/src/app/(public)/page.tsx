import { ArrowRight, BellRing, CalendarCheck2, CreditCard, RefreshCcw, ShieldCheck, Video } from 'lucide-react';
import Link from 'next/link';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { TeacherCard } from '@/features/teachers/teacher-card';
import { HeroSearch } from '@/features/teachers/hero-search';
import { serverGet } from '@/lib/server-api';
import type { Catalogue, Paginated, PlatformConfig, TeacherCard as T } from '@/types/api';

export const revalidate = 60;

const STEPS = [
  { icon: CalendarCheck2, title: 'Pick a real time slot', body: 'Availability comes straight from each teacher’s working hours, in your timezone. Slots you see are bookable.' },
  { icon: CreditCard, title: 'Pay securely', body: 'Checkout runs on Razorpay. Your booking is confirmed only after our server verifies the payment.' },
  { icon: Video, title: 'Join on Google Meet', body: 'Your Meet link appears on the booking and in your email. Add the session to any calendar in one click.' },
];

const FEATURES = [
  { icon: ShieldCheck, title: 'Verified teachers', body: 'Every profile is reviewed by our team before it goes live.' },
  { icon: BellRing, title: 'Reminders that adapt', body: 'Email and in-app reminders before each session, rescheduled automatically when plans change.' },
  { icon: RefreshCcw, title: 'Clear, fair policies', body: 'See the exact refund you’d get before you pay. Reschedule from the booking page.' },
];

export default async function HomePage() {
  const [catalogue, teachers, config] = await Promise.all([
    serverGet<Catalogue>('/subjects'),
    serverGet<Paginated<T>>('/teachers?pageSize=6&sort=recommended'),
    serverGet<PlatformConfig>('/platform/config'),
  ]);
  const subjects = catalogue?.categories.flatMap((c) => c.subjects) ?? [];
  const popular = [...subjects].sort((a, b) => b.teacherCount - a.teacherCount).slice(0, 8);

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="aurora pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <div className="grid-fade pointer-events-none absolute inset-0 -z-10 opacity-60" aria-hidden />
        <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-[12.5px] text-muted-foreground backdrop-blur">
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              {config ? `${config.counts.teachers} verified teachers across ${config.counts.subjects} subjects` : 'Live 1:1 tutoring'}
            </p>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-6xl">
              Learn from a teacher who <span className="bg-gradient-to-r from-accent to-[oklch(0.62_0.18_320)] bg-clip-text text-transparent">fits how you think.</span>
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-5 max-w-xl text-pretty text-[17px] leading-relaxed text-muted-foreground">
              Browse verified tutors by subject, book a live session in their real availability, and meet on Google Meet. Payments, reminders and rescheduling are handled for you.
            </p>
          </Reveal>
          <Reveal delay={0.15} className="mt-8 max-w-xl">
            <HeroSearch subjects={subjects.map((s) => ({ slug: s.slug, name: s.name }))} />
          </Reveal>
          {popular.length > 0 && (
            <Reveal delay={0.2}>
              <div className="mt-5 flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-muted-foreground">Popular:</span>
                {popular.slice(0, 6).map((s) => (
                  <Link key={s.slug} href={`/subjects/${s.slug}`} className="rounded-full border border-border bg-surface/70 px-3 py-1 text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground">
                    {s.name}
                  </Link>
                ))}
              </div>
            </Reveal>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <Reveal>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Teachers students book</h2>
              <p className="mt-2 text-muted-foreground">Real profiles, real rates, real availability.</p>
            </div>
            <Button asChild variant="secondary" className="hidden sm:inline-flex">
              <Link href="/teachers">
                All teachers <ArrowRight />
              </Link>
            </Button>
          </div>
        </Reveal>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(teachers?.data ?? []).map((t, i) => (
            <Reveal key={t.id} delay={i * 0.04}>
              <TeacherCard teacher={t} />
            </Reveal>
          ))}
        </div>
        {!teachers && <p className="mt-8 text-sm text-muted-foreground">Teachers are temporarily unavailable. Please refresh in a moment.</p>}
      </section>

      <section className="border-y border-border bg-surface-2/50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">From search to session in three steps</h2>
          </Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.06}>
                <div className="relative h-full rounded-2xl border border-border bg-surface p-6 shadow-soft">
                  <span className="absolute right-5 top-5 font-mono text-[12px] text-muted-foreground">0{i + 1}</span>
                  <div className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
                    <s.icon className="size-5" />
                  </div>
                  <h3 className="mt-5 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1fr_1.4fr] md:items-start">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Built so nothing falls through the cracks</h2>
            <p className="mt-3 text-muted-foreground">Two people can’t book the same slot. A payment is never counted until it’s verified. If anything goes wrong, you’re refunded automatically.</p>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.05}>
                <div className="h-full rounded-2xl border border-border p-5">
                  <f.icon className="size-5 text-accent" />
                  <h3 className="mt-3 text-[15px] font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-border bg-foreground px-8 py-12 text-background sm:px-12">
            <div className="aurora pointer-events-none absolute inset-0 opacity-40" aria-hidden />
            <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Teach on TeachMe</h2>
                <p className="mt-2 max-w-lg opacity-75">Set your hours and rates, connect Google Calendar, and we’ll handle bookings, payments, Meet links and reminders.</p>
              </div>
              <Button asChild size="lg" variant="secondary" className="shrink-0">
                <Link href="/register?role=TEACHER">Apply to teach</Link>
              </Button>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
