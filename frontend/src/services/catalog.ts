import { api } from '@/lib/api';
import type { Catalogue, Paginated, Quote, Slot, TeacherCard, TeacherProfile } from '@/types/api';

export interface TeacherSearch {
  subject?: string;
  q?: string;
  minPrice?: number;
  maxPrice?: number;
  language?: string;
  availableOn?: number;
  minExperience?: number;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export const catalogService = {
  subjects: () => api<Catalogue>('/subjects'),
  teachers: (q: TeacherSearch) => api<Paginated<TeacherCard>>('/teachers', { query: q as Record<string, string | number> }),
  teacher: (slug: string) => api<TeacherProfile>(`/teachers/${encodeURIComponent(slug)}`),
  slots: (teacherId: string, from: string, to: string, durationMinutes: number) =>
    api<{ timezone: string; slots: Slot[] }>(`/availability/teachers/${teacherId}/slots`, { query: { from, to, durationMinutes } }),
  quote: (teacherId: string, subjectId: string, durationMinutes: number) =>
    api<Quote>(`/teachers/${teacherId}/quote`, { query: { subjectId, durationMinutes } }),
};
