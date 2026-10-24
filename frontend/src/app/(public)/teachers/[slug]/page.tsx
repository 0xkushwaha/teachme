import { Award, Clock, GraduationCap, Languages, Timer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar, Badge, Card } from '@/components/ui/primitives';
import { BookingWidget } from '@/features/booking/booking-widget';
import { serverGet } from '@/lib/server-api';
import type { TeacherProfile } from '@/types/api';
import { formatMoney } from '@/utils/format';


export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = await serverGet<TeacherProfile>(`/teachers/${slug}`);
  return t ? { title: `${t.name} — ${t.subjects.map((s) => s.name).join(', ')}`, description: t.headline } : { title: 'Teacher not found' };
}

export default async function TeacherPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ subject?: string }> }) {
  const [{ slug }, { subject }] = await Promise.all([params, searchParams]);
  const t = await serverGet<TeacherProfile>(`/teachers/${slug}`, 30);
  if (!t) notFound();
  const notice = t.minNoticeMinutes >= 60 ? `${Math.round(t.minNoticeMinutes / 60)}h` : `${t.minNoticeMinutes} min`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-6 text-[13px] text-muted-foreground">
        <Link href="/teachers" className="hover:text-foreground">Teachers</Link> / <span className="text-foreground">{t.name}</span>
      </nav>
      <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
        <div className="space-y-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <Avatar name={t.name} src={t.avatarUrl} size={88} className="ring-4 ring-surface" />
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{t.name}</h1>
              <p className="mt-2 text-[17px] leading-relaxed text-muted-foreground">{t.headline}</p>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><Award className="size-4" />{t.yearsExperience} years teaching</span>
                <span className="inline-flex items-center gap-1.5"><Languages className="size-4" />{t.languages.join(', ')}</span>
                {t.completedSessions > 0 && <span className="inline-flex items-center gap-1.5"><GraduationCap className="size-4" />{t.completedSessions} sessions on TeachMe</span>}
              </div>
            </div>
          </div>

          <section aria-labelledby="about">
            <h2 id="about" className="text-lg font-semibold tracking-tight">About</h2>
            <div className="mt-3 space-y-3 whitespace-pre-line text-[15px] leading-[1.75] text-foreground/90">{t.bio}</div>
          </section>

          <section aria-labelledby="subjects">
            <h2 id="subjects" className="text-lg font-semibold tracking-tight">Subjects & rates</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {t.subjects.map((s) => (
                <Card key={s.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    {s.levels && <p className="text-[13px] text-muted-foreground">{s.levels}</p>}
                  </div>
                  <p className="text-right font-semibold tabular-nums">{formatMoney(s.hourlyRateMinor, s.currency)}<span className="block text-[12px] font-normal text-muted-foreground">per hour</span></p>
                </Card>
              ))}
            </div>
          </section>

          {t.qualifications.length > 0 && (
            <section aria-labelledby="quals">
              <h2 id="quals" className="text-lg font-semibold tracking-tight">Qualifications</h2>
              <ul className="mt-3 space-y-2">
                {t.qualifications.map((q, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-xl border border-border p-4">
                    <GraduationCap className="mt-0.5 size-4 text-accent" />
                    <div>
                      <p className="font-medium">{q.title}</p>
                      <p className="text-[13px] text-muted-foreground">{q.institution}{q.year ? ` · ${q.year}` : ''}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="logistics">
            <h2 id="logistics" className="text-lg font-semibold tracking-tight">Session details</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {t.sessionDurations.map((d) => <Badge key={d}><Timer className="size-3" />{d} min</Badge>)}
              <Badge><Clock className="size-3" />Book at least {notice} ahead</Badge>
              <Badge>Up to {t.maxAdvanceDays} days in advance</Badge>
              <Badge>Teacher timezone: {t.timezone.replace(/_/g, ' ')}</Badge>
            </div>
          </section>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <BookingWidget teacher={t} initialSubject={subject} />
        </div>
      </div>
    </div>
  );
}
