import type { Metadata } from 'next';
import Link from 'next/link';
import { Reveal } from '@/components/motion/reveal';
import { PageHeader } from '@/components/ui/primitives';
import { serverGet } from '@/lib/server-api';
import type { Catalogue } from '@/types/api';
import { formatMoney } from '@/utils/format';

export const metadata: Metadata = { title: 'Browse subjects', description: 'Every subject taught on TeachMe, with the number of verified teachers and starting rates.' };

export default async function SubjectsPage() {
  const catalogue = await serverGet<Catalogue>('/subjects');
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <PageHeader eyebrow="Subjects" title="What would you like to learn?" description="Pick a subject to see every teacher who teaches it, their rates and their next available times." />
      {!catalogue && <p className="text-sm text-muted-foreground">Subjects are temporarily unavailable. Please refresh shortly.</p>}
      <div className="space-y-12">
        {catalogue?.categories.filter((c) => c.subjects.length).map((c) => (
          <section key={c.id} aria-labelledby={`cat-${c.slug}`}>
            <h2 id={`cat-${c.slug}`} className="mb-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{c.name}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {c.subjects.map((s, i) => (
                <Reveal key={s.id} delay={i * 0.03}>
                  <Link href={`/subjects/${s.slug}`} className="group flex h-full flex-col rounded-2xl border border-border bg-surface p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift">
                    <h3 className="font-semibold tracking-tight group-hover:text-accent">{s.name}</h3>
                    <p className="mt-1.5 line-clamp-2 flex-1 text-[13.5px] leading-relaxed text-muted-foreground">{s.description}</p>
                    <div className="mt-4 flex items-center justify-between text-[13px]">
                      <span className="text-muted-foreground">{s.teacherCount ? `${s.teacherCount} teacher${s.teacherCount === 1 ? '' : 's'}` : 'No teachers yet'}</span>
                      {s.fromHourlyRateMinor && <span className="font-medium tabular-nums">from {formatMoney(s.fromHourlyRateMinor)}/hr</span>}
                    </div>
                  </Link>
                </Reveal>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
