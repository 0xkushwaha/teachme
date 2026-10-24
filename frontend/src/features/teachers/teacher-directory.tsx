'use client';
import { useQuery } from '@tanstack/react-query';
import { SearchX, SlidersHorizontal } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Input, Select } from '@/components/ui/form';
import { EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { catalogService } from '@/services/catalog';
import { TeacherCard } from './teacher-card';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LANGS = ['English', 'Hindi', 'Spanish', 'Tamil', 'Telugu', 'Bengali', 'Malayalam', 'Gujarati', 'Punjabi', 'Urdu'];

/** Filters live in the URL so results are shareable and survive refresh. */
export function TeacherDirectory({ subjects }: { subjects: { slug: string; name: string }[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string) => params.get(k) ?? '';
  const [q, setQ] = useState(get('q'));
  const [showFilters, setShowFilters] = useState(false);

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  useEffect(() => {
    const t = setTimeout(() => q !== get('q') && set({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = {
    subject: get('subject') || undefined,
    q: get('q') || undefined,
    language: get('language') || undefined,
    availableOn: get('day') ? Number(get('day')) : undefined,
    minExperience: get('exp') ? Number(get('exp')) : undefined,
    maxPrice: get('maxPrice') ? Number(get('maxPrice')) * 100 : undefined,
    sort: get('sort') || 'recommended',
    page: Number(get('page') || 1),
    pageSize: 12,
  };
  const res = useQuery({ queryKey: ['public', 'teachers', query], queryFn: () => catalogService.teachers(query), placeholderData: (prev) => prev });
  const activeFilters = ['language', 'day', 'exp', 'maxPrice'].filter((k) => get(k)).length;
  const subjectName = subjects.find((s) => s.slug === query.subject)?.name;

  return (
    <>
      <PageHeader eyebrow="Teachers" title={subjectName ? `${subjectName} teachers` : 'Find your teacher'} description="Every teacher here is verified and bookable. Prices are per hour before platform fees, which are shown at checkout." />
      <div className="mb-6 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="dir-q" className="sr-only">Search</label>
          <Input id="dir-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, headline or subject" className="sm:max-w-sm" />
          <label htmlFor="dir-subject" className="sr-only">Subject</label>
          <Select id="dir-subject" value={get('subject')} onChange={(e) => set({ subject: e.target.value })} className="sm:w-52">
            <option value="">All subjects</option>
            {subjects.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
          </Select>
          <label htmlFor="dir-sort" className="sr-only">Sort</label>
          <Select id="dir-sort" value={get('sort') || 'recommended'} onChange={(e) => set({ sort: e.target.value })} className="sm:w-48">
            <option value="recommended">Recommended</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="experience">Most experienced</option>
            <option value="newest">Newest</option>
          </Select>
          <Button variant="secondary" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} aria-controls="dir-filters">
            <SlidersHorizontal /> Filters{activeFilters ? ` (${activeFilters})` : ''}
          </Button>
        </div>
        {showFilters && (
          <div id="dir-filters" className="grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label htmlFor="f-lang" className="text-[13px] font-medium">Language</label>
              <Select id="f-lang" value={get('language')} onChange={(e) => set({ language: e.target.value })}>
                <option value="">Any</option>
                {LANGS.map((l) => <option key={l}>{l}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="f-day" className="text-[13px] font-medium">Teaches on</label>
              <Select id="f-day" value={get('day')} onChange={(e) => set({ day: e.target.value })}>
                <option value="">Any day</option>
                {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="f-exp" className="text-[13px] font-medium">Experience</label>
              <Select id="f-exp" value={get('exp')} onChange={(e) => set({ exp: e.target.value })}>
                <option value="">Any</option>
                <option value="3">3+ years</option>
                <option value="5">5+ years</option>
                <option value="10">10+ years</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="f-price" className="text-[13px] font-medium">Max hourly rate (₹)</label>
              <Input id="f-price" type="number" min={0} step={100} inputMode="numeric" defaultValue={get('maxPrice')} onBlur={(e) => set({ maxPrice: e.target.value })} placeholder="e.g. 1500" />
            </div>
            {activeFilters > 0 && (
              <button className="text-left text-[13px] text-accent underline-offset-4 hover:underline" onClick={() => set({ language: '', day: '', exp: '', maxPrice: '' })}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {res.isError ? (
        <ErrorState message={errorMessage(res.error)} onRetry={() => res.refetch()} />
      ) : res.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-60 rounded-2xl" />)}</div>
      ) : res.data?.data.length ? (
        <>
          <p className="mb-3 text-[13px] text-muted-foreground" aria-live="polite">
            {res.data.meta.total} teacher{res.data.meta.total === 1 ? '' : 's'}
          </p>
          <div className={`grid gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-3 ${res.isFetching ? 'opacity-60' : ''}`}>
            {res.data.data.map((t) => <TeacherCard key={t.id} teacher={t} subjectSlug={query.subject} />)}
          </div>
          <Pagination page={res.data.meta.page} totalPages={res.data.meta.totalPages} onPage={(p) => set({ page: String(p) })} />
        </>
      ) : (
        <EmptyState icon={<SearchX />} title="No teachers match these filters" description="Try removing a filter or searching for a broader topic." action={<Button variant="secondary" onClick={() => router.replace(pathname)}>Reset search</Button>} />
      )}
    </>
  );
}
