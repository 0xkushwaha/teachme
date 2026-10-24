'use client';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function HeroSearch({ subjects }: { subjects: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [q, setQ] = useState('');
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const p = new URLSearchParams();
        if (subject) p.set('subject', subject);
        if (q.trim()) p.set('q', q.trim());
        router.push(`/teachers${p.size ? `?${p}` : ''}`);
      }}
      className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-2 shadow-lift sm:flex-row sm:items-center"
    >
      <label className="sr-only" htmlFor="hero-subject">Subject</label>
      <select id="hero-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-11 rounded-xl bg-transparent px-3 text-sm outline-none hover:bg-muted sm:w-48">
        <option value="">Any subject</option>
        {subjects.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name}
          </option>
        ))}
      </select>
      <div className="hidden h-6 w-px bg-border sm:block" />
      <div className="flex flex-1 items-center gap-2 px-3">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <label className="sr-only" htmlFor="hero-q">Search teachers</label>
        <input id="hero-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Teacher name or topic, e.g. “organic chemistry”" className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </div>
      <Button type="submit" size="lg" className="sm:h-11">
        Find teachers
      </Button>
    </form>
  );
}
