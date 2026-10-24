'use client';
import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { TeacherDirectory } from '@/features/teachers/teacher-directory';
import { catalogService } from '@/services/catalog';

export default function FindTeacher() {
  const subjects = useQuery({ queryKey: ['public', 'subjects'], queryFn: catalogService.subjects, staleTime: 300_000 });
  const list = subjects.data?.categories.flatMap((c) => c.subjects.map((s) => ({ slug: s.slug, name: s.name }))) ?? [];
  return <Suspense><TeacherDirectory subjects={list} /></Suspense>;
}
