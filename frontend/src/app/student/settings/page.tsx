'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { AccountSettings } from '@/features/account/account-settings';
import { errorMessage } from '@/lib/api';
import { accountService } from '@/services/account';

const schema = z.object({ gradeLevel: z.string().max(60).optional(), learningGoals: z.string().max(1000).optional(), preferredLanguage: z.string().max(40).optional() });

function LearningProfile() {
  const q = useQuery({ queryKey: ['student', 'profile'], queryFn: accountService.studentProfile });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), values: { gradeLevel: q.data?.gradeLevel ?? '', learningGoals: q.data?.learningGoals ?? '', preferredLanguage: q.data?.preferredLanguage ?? '' } });
  const save = useMutation({ mutationFn: accountService.updateStudentProfile, onSuccess: () => toast.success('Learning profile saved'), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Card>
      <CardHeader title="Learning profile" description="Shared with teachers you book so they can prepare." />
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Level or grade" htmlFor="lp-grade"><Input placeholder="e.g. Class 12 (CBSE)" {...form.register('gradeLevel')} /></Field>
        <Field label="Preferred language" htmlFor="lp-lang"><Input placeholder="e.g. English" {...form.register('preferredLanguage')} /></Field>
        <Field label="Goals" htmlFor="lp-goals" className="sm:col-span-2"><Textarea placeholder="What do you want to get out of your sessions?" {...form.register('learningGoals')} /></Field>
        <div className="sm:col-span-2"><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Card>
  );
}

export default function StudentSettings() {
  return (
    <>
      <PageHeader title="Settings" description="Profile, preferences and privacy." />
      <AccountSettings extra={<LearningProfile />} />
    </>
  );
}
