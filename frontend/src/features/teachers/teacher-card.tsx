import { Clock, Languages } from 'lucide-react';
import Link from 'next/link';
import { Avatar, Badge } from '@/components/ui/primitives';
import type { TeacherCard as T } from '@/types/api';
import { formatMoney } from '@/utils/format';

export function TeacherCard({ teacher, subjectSlug }: { teacher: T; subjectSlug?: string }) {
  const focus = teacher.subjects.find((s) => s.slug === subjectSlug) ?? teacher.subjects[0];
  return (
    <Link
      href={`/teachers/${teacher.slug}${subjectSlug ? `?subject=${subjectSlug}` : ''}`}
      className="group relative flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift"
    >
      <div className="flex items-start gap-3.5">
        <Avatar name={teacher.name} src={teacher.avatarUrl} size={48} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold tracking-tight group-hover:text-accent">{teacher.name}</h3>
          <p className="mt-0.5 line-clamp-2 text-[13.5px] leading-snug text-muted-foreground">{teacher.headline}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {teacher.subjects.slice(0, 3).map((s) => (
          <Badge key={s.id} tone={s.slug === subjectSlug ? 'accent' : 'neutral'}>
            {s.name}
          </Badge>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-4 text-[12.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Languages className="size-3.5" />
          {teacher.languages.slice(0, 2).join(', ')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3.5" />
          {teacher.yearsExperience} yrs exp.
        </span>
      </div>
      <div className="mt-5 flex items-end justify-between border-t border-border pt-4">
        <div>
          <p className="text-[12px] text-muted-foreground">{focus ? `${focus.name} from` : 'From'}</p>
          <p className="text-lg font-semibold tabular-nums">
            {formatMoney(focus?.hourlyRateMinor ?? teacher.fromHourlyRateMinor)}
            <span className="text-[13px] font-normal text-muted-foreground"> /hr</span>
          </p>
        </div>
        <span className="text-[13px] font-medium text-accent opacity-80 transition-opacity group-hover:opacity-100">View profile →</span>
      </div>
    </Link>
  );
}
