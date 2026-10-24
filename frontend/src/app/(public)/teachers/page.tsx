import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TeacherDirectory } from '@/features/teachers/teacher-directory';
import { serverGet } from '@/lib/server-api';
import type { Catalogue } from '@/types/api';

export const metadata: Metadata = { title: 'Find a teacher', description: 'Search and filter verified teachers by subject, price, language, experience and availability.' };

export default async function TeachersPage() {
  const catalogue = await serverGet<Catalogue>('/subjects');
  const subjects = catalogue?.categories.flatMap((c) => c.subjects.map((s) => ({ slug: s.slug, name: s.name }))) ?? [];
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <Suspense>
        <TeacherDirectory subjects={subjects} />
      </Suspense>
    </div>
  );
}
