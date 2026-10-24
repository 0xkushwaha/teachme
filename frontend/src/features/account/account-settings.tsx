'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Dialog, Switch } from '@/components/ui/overlay';
import { Card, CardHeader, Skeleton } from '@/components/ui/primitives';
import { passwordRule } from '@/features/auth/register-form';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { accountService, notificationService } from '@/services/account';
import { authService } from '@/services/auth';
import type { NotificationPreference } from '@/types/api';
import { browserTimezone } from '@/utils/format';

const ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Madrid', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];

export function AccountSettings({ extra }: { extra?: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <ProfileCard />
      {extra}
      <PreferencesCard />
      <PasswordCard />
      <PrivacyCard />
    </div>
  );
}

function ProfileCard() {
  const { user, setUser } = useAuth();
  const zones = [...new Set([user?.timezone ?? '', browserTimezone(), ...ZONES].filter(Boolean))];
  const schema = z.object({ fullName: z.string().trim().min(2).max(100), timezone: z.string(), phone: z.string().trim().regex(/^(\+?[0-9 ()-]{7,20})?$/, 'Enter a valid phone number').optional() });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), values: { fullName: user?.fullName ?? '', timezone: user?.timezone ?? browserTimezone(), phone: user?.phone ?? '' } });
  const save = useMutation({ mutationFn: (v: z.infer<typeof schema>) => accountService.update({ ...v, phone: v.phone || undefined }), onSuccess: (u) => { setUser(u); toast.success('Profile saved'); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Card>
      <CardHeader title="Profile" description="Your name and timezone are used across bookings and emails." />
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Full name" htmlFor="s-name" error={form.formState.errors.fullName?.message}><Input {...form.register('fullName')} /></Field>
        <Field label="Email" htmlFor="s-email" hint="Contact support to change your email."><Input value={user?.email ?? ''} disabled readOnly /></Field>
        <Field label="Timezone" htmlFor="s-tz" hint="All session times are shown in this timezone."><Select {...form.register('timezone')}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</Select></Field>
        <Field label="Phone (optional)" htmlFor="s-phone" error={form.formState.errors.phone?.message}><Input type="tel" autoComplete="tel" {...form.register('phone')} /></Field>
        <div className="sm:col-span-2"><Button type="submit" loading={save.isPending}>Save profile</Button></div>
      </form>
    </Card>
  );
}

const CATS: { key: NotificationPreference['category']; label: string; hint: string }[] = [
  { key: 'BOOKING', label: 'Booking updates', hint: 'New bookings, Meet links. Confirmations & cancellations are always emailed.' },
  { key: 'REMINDER', label: 'Session reminders', hint: 'Before each session.' },
  { key: 'PAYMENT', label: 'Payment updates', hint: 'Failed payments. Refund updates are always emailed.' },
  { key: 'MARKETING', label: 'Product news', hint: 'Occasional updates. Off by default.' },
];

function PreferencesCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['prefs'], queryFn: notificationService.preferences });
  const save = useMutation({ mutationFn: notificationService.setPreferences, onSuccess: (p) => { qc.setQueryData(['prefs'], p); toast.success('Preferences saved'); }, onError: (e) => toast.error(errorMessage(e)) });
  const get = (c: string, ch: string) => q.data?.find((p) => p.category === c && p.channel === ch)?.enabled ?? false;
  const toggle = (category: NotificationPreference['category'], channel: NotificationPreference['channel'], enabled: boolean) => save.mutate([{ category, channel, enabled }]);
  return (
    <Card>
      <CardHeader title="Notifications" description="Choose how we contact you. Security and account emails are always sent." />
      {q.isLoading ? <div className="p-5"><Skeleton className="h-40" /></div> : (
        <div className="divide-y divide-border">
          <div className="grid grid-cols-[1fr_64px_64px] gap-2 px-5 py-2 text-[12px] font-medium text-muted-foreground"><span /> <span className="text-center">Email</span><span className="text-center">In-app</span></div>
          {CATS.map((c) => (
            <div key={c.key} className="grid grid-cols-[1fr_64px_64px] items-center gap-2 px-5 py-3">
              <div><p className="text-sm font-medium">{c.label}</p><p className="text-[12.5px] text-muted-foreground">{c.hint}</p></div>
              <div className="flex justify-center"><Switch label={`${c.label} by email`} checked={get(c.key, 'EMAIL')} onCheckedChange={(v) => toggle(c.key, 'EMAIL', v)} disabled={save.isPending} /></div>
              <div className="flex justify-center"><Switch label={`${c.label} in app`} checked={get(c.key, 'IN_APP')} onCheckedChange={(v) => toggle(c.key, 'IN_APP', v)} disabled={save.isPending} /></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PasswordCard() {
  const schema = z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordRule });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const change = useMutation({ mutationFn: (v: z.infer<typeof schema>) => authService.changePassword(v.currentPassword, v.newPassword), onSuccess: () => { form.reset(); toast.success('Password changed'); }, onError: (e) => toast.error(errorMessage(e)) });
  const e = form.formState.errors;
  return (
    <Card>
      <CardHeader title="Password" />
      <form onSubmit={form.handleSubmit((v) => change.mutate(v))} className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Current password" htmlFor="pw-cur" error={e.currentPassword?.message}><Input type="password" autoComplete="current-password" {...form.register('currentPassword')} /></Field>
        <Field label="New password" htmlFor="pw-new" error={e.newPassword?.message}><Input type="password" autoComplete="new-password" {...form.register('newPassword')} /></Field>
        <div className="sm:col-span-2"><Button type="submit" variant="secondary" loading={change.isPending}>Change password</Button></div>
      </form>
    </Card>
  );
}

function PrivacyCard() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { logout } = useAuth();
  const del = useMutation({ mutationFn: () => accountService.deleteAccount(password), onSuccess: () => { toast.success('Your account has been deleted.'); logout(); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Card>
      <CardHeader title="Your data" description="Download everything we hold about you, or delete your account." />
      <div className="flex flex-wrap gap-2 p-5">
        <Button asChild variant="secondary"><a href={accountService.exportUrl}><Download />Download my data</a></Button>
        <Button variant="ghost" className="text-danger" onClick={() => setOpen(true)}><Trash2 />Delete account</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title="Delete your account?" description="Your profile and contact details are erased immediately. Booking and payment records are kept without your personal details, as required for financial records. This can’t be undone." footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" disabled={confirm !== 'DELETE' || !password} loading={del.isPending} onClick={() => del.mutate()}>Delete permanently</Button></>}>
        <div className="space-y-4">
          <Field label="Password" htmlFor="del-pw"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="Type DELETE to confirm" htmlFor="del-confirm"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        </div>
      </Dialog>
    </Card>
  );
}
