'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { AccountSettings } from '@/features/account/account-settings';
import { errorMessage } from '@/lib/api';
import { teacherService } from '@/services/teacher';
import { browserTimezone } from '@/utils/format';

const ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Madrid', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];

function TeachingTimezone() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['teacher', 'availability'], queryFn: teacherService.availability });
  const [tz, setTz] = useState('');
  useEffect(() => q.data && setTz(q.data.settings.timezone), [q.data]);
  const save = useMutation({ mutationFn: () => teacherService.updateSettings({ timezone: tz }), onSuccess: (d) => { qc.setQueryData(['teacher', 'availability'], d); toast.success('Teaching timezone saved'); }, onError: (e) => toast.error(errorMessage(e)) });
  const zones = [...new Set([tz, browserTimezone(), ...ZONES].filter(Boolean))];
  return (
    <Card>
      <CardHeader title="Teaching timezone" description="Your weekly hours are interpreted in this timezone, including across daylight-saving changes." />
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
        <Field label="Timezone" htmlFor="t-tz" className="sm:w-72"><Select value={tz} onChange={(e) => setTz(e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</Select></Field>
        <Button onClick={() => save.mutate()} disabled={!tz || tz === q.data?.settings.timezone} loading={save.isPending}>Save</Button>
      </div>
    </Card>
  );
}

export default function TeacherSettings() {
  return (
    <>
      <PageHeader title="Account settings" />
      <AccountSettings extra={<TeachingTimezone />} />
    </>
  );
}
