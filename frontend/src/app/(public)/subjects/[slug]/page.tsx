import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { TeacherCard } from '@/features/teachers/teacher-card';
import { serverGet } from '@/lib/server-api';
import type { Paginated, TeacherCard as T } from '@/types/api';

type Subject = { id: string; slug: string; name: string; description: string; category: { slug: string; name: string } };
export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = await serverGet<Subject>(`/subjects/${slug}`);
  return s ? { title: `${s.name} tutors`, description: s.description } : { title: 'Subject not found' };
}

export default async function SubjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [subject, teachers] = await Promise.all([serverGet<Subject>(`/subjects/${slug}`), serverGet<Paginated<T>>(`/teachers?subject=${encodeURIComponent(slug)}&pageSize=24`)]);
  if (!subject) notFound();
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-4 text-[13px] text-muted-foreground">
        <Link href="/subjects" className="hover:text-foreground">Subjects</Link> / <span>{subject.category.name}</span>
      </nav>
      <PageHeader
        title={`${subject.name} teachers`}
        description={subject.description}
        actions={
          <Button asChild variant="secondary">
            <Link href={`/teachers?subject=${subject.slug}`}>Filter & sort</Link>
          </Button>
        }
      />
      {teachers?.data.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teachers.data.map((t) => (
            <TeacherCard key={t.id} teacher={t} subjectSlug={subject.slug} />
          ))}
        </div>
      ) : (
        <EmptyState title={`No ${subject.name} teachers yet`} description="We're onboarding new teachers every week. Browse related subjects or get in touch and we'll help you find someone." action={<Button asChild variant="secondary"><Link href="/subjects">Browse subjects</Link></Button>} />
      )}
    </div>
  );
}
