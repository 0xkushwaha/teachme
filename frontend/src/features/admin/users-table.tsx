'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { Alert, EmptyState, ErrorState, Pagination, Skeleton, StatusBadge, Table } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { formatDate, formatDateTime, formatMoney, relative } from '@/utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function UsersTable({ role }: { role?: 'STUDENT' | 'ADMIN' }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [roleFilter, setRoleFilter] = useState(role ?? '');
  const [action, setAction] = useState<{ user: any; status: string } | null>(null);
  const [reason, setReason] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin', 'users', page, search, status, roleFilter], queryFn: () => adminService.users({ page, q: search || undefined, status: status || undefined, role: roleFilter || undefined }), placeholderData: keepPreviousData });
  const setUserStatus = useMutation({
    mutationFn: () => adminService.setUserStatus(action!.user.id, action!.status, reason || undefined),
    onSuccess: () => { toast.success('Account updated'); setAction(null); setReason(''); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setRole = useMutation({ mutationFn: ({ id, r }: { id: string; r: string }) => adminService.setUserRole(id, r), onSuccess: () => { toast.success('Role updated; their sessions were signed out'); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Search users" placeholder="Search name or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="sm:max-w-xs" />
        <Select aria-label="Role" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} className="sm:w-40"><option value="">All roles</option><option value="STUDENT">Students</option><option value="TEACHER">Teachers</option><option value="ADMIN">Admins</option></Select>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-40"><option value="">Active & suspended</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="DEACTIVATED">Deactivated</option><option value="DELETED">Deleted</option></Select>
      </div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : q.data?.data.length ? (
        <>
          <Table>
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Verified</th><th>Last login</th><th>Bookings</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {q.data.data.map((u: any) => (
                <tr key={u.id}>
                  <td><button onClick={() => setDetailId(u.id)} className="text-left font-medium hover:underline">{u.fullName}</button><p className="text-[12px] text-muted-foreground">{u.email}</p></td>
                  <td>
                    <Select aria-label={`Role for ${u.fullName}`} value={u.role} onChange={(e) => setRole.mutate({ id: u.id, r: e.target.value })} className="h-8 w-28 text-[13px]">
                      {(u.teacherProfile ? ['TEACHER', 'ADMIN'] : ['STUDENT', 'ADMIN']).map((r) => <option key={r}>{r}</option>)}
                    </Select>
                  </td>
                  <td><StatusBadge status={u.status} /></td>
                  <td>{u.emailVerifiedAt ? 'Yes' : <span className="text-muted-foreground">No</span>}</td>
                  <td className="text-muted-foreground">{u.lastLoginAt ? relative(u.lastLoginAt) : 'Never'}</td>
                  <td className="tabular-nums">{u._count.bookingsAsStudent}</td>
                  <td className="text-right">
                    {u.status === 'ACTIVE' ? <Button size="sm" variant="ghost" className="text-danger" onClick={() => setAction({ user: u, status: 'SUSPENDED' })}>Suspend</Button>
                      : u.status !== 'DELETED' ? <Button size="sm" variant="ghost" onClick={() => setAction({ user: u, status: 'ACTIVE' })}>Reactivate</Button> : null}
                    {u.status === 'ACTIVE' && <Button size="sm" variant="ghost" onClick={() => setAction({ user: u, status: 'DEACTIVATED' })}>Deactivate</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      ) : <EmptyState title="No users match" />}
      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)} title={`${action?.status === 'ACTIVE' ? 'Reactivate' : action?.status === 'SUSPENDED' ? 'Suspend' : 'Deactivate'} ${action?.user.fullName ?? ''}?`} description={action?.status === 'ACTIVE' ? 'They will be able to sign in again.' : 'They are signed out immediately and cannot sign in. Existing bookings are not cancelled automatically.'}
        footer={<><Button variant="secondary" onClick={() => setAction(null)}>Cancel</Button><Button variant={action?.status === 'ACTIVE' ? 'primary' : 'danger'} loading={setUserStatus.isPending} onClick={() => setUserStatus.mutate()}>Confirm</Button></>}>
        <Input aria-label="Reason" placeholder="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>
      {detailId && <UserDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

/** Account profile, activity and the permanent-removal flow (requires re-typing the email). */
function UserDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { timezone } = useAuth();
  const q = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => adminService.userDetail(id) });
  const [removing, setRemoving] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [reason, setReason] = useState('');
  const remove = useMutation({
    mutationFn: () => adminService.removeUser(id, confirmEmail.trim(), reason.trim()),
    onSuccess: () => { toast.success('Account removed and personal data erased'); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={d?.user.fullName ?? 'Account'} description={d?.user.email} size="lg">
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : !d ? <Skeleton className="h-64" /> : !removing ? (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap gap-2"><StatusBadge status={d.user.role} label={d.user.role.toLowerCase()} /><StatusBadge status={d.user.status} />{d.user.emailVerifiedAt ? null : <StatusBadge status="PENDING" label="Email not verified" />}{d.user.lockedUntil && new Date(d.user.lockedUntil) > new Date() && <StatusBadge status="SUSPENDED" label="Locked (failed logins)" />}</div>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div><dt className="text-[12px] text-muted-foreground">Joined</dt><dd>{formatDate(d.user.createdAt, timezone)}</dd></div>
            <div><dt className="text-[12px] text-muted-foreground">Last sign-in</dt><dd>{d.user.lastLoginAt ? relative(d.user.lastLoginAt) : 'Never'}</dd></div>
            <div><dt className="text-[12px] text-muted-foreground">Active sessions</dt><dd>{d.activeSessions}</dd></div>
            <div><dt className="text-[12px] text-muted-foreground">Bookings</dt><dd>{Object.entries(d.bookings as Record<string, number>).map(([k, v]) => `${v} ${k.toLowerCase().replace('_', ' ')}`).join(', ') || 'None'}</dd></div>
            <div><dt className="text-[12px] text-muted-foreground">Paid (net)</dt><dd>{formatMoney(d.paidMinor)}</dd></div>
            <div><dt className="text-[12px] text-muted-foreground">Support tickets</dt><dd>{d.supportTickets}</dd></div>
          </dl>
          <div>
            <p className="mb-2 text-[13px] font-medium">Recent activity</p>
            {d.activity.length ? (
              <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {d.activity.map((a: any) => (
                  <li key={a.id} className="flex justify-between gap-3 px-3 py-2 text-[13px]"><span><span className="font-mono text-[12px]">{a.action}</span>{a.actor && a.actor.fullName !== d.user.fullName ? ` by ${a.actor.fullName}` : ''}</span><span className="shrink-0 text-muted-foreground">{formatDateTime(a.createdAt, timezone)}</span></li>
                ))}
              </ul>
            ) : <p className="text-muted-foreground">No recorded activity.</p>}
          </div>
          {d.user.status !== 'DELETED' && d.user.role !== 'ADMIN' && (
            <div className="flex justify-end border-t border-border pt-4"><Button variant="ghost" className="text-danger" onClick={() => setRemoving(true)}>Remove account…</Button></div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Alert tone="danger" title="This permanently erases personal data">Name, email, documents, notifications and calendar connections are deleted. Booking, payment and earnings records are kept without contact details for financial record-keeping. Upcoming sessions must be cancelled first.</Alert>
          <Field label={`Type ${d.user.email} to confirm`} htmlFor="rm-email"><Input autoComplete="off" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} /></Field>
          <Field label="Reason (audit log)" htmlFor="rm-reason" hint="At least 5 characters"><Input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setRemoving(false)}>Back</Button>
            <Button variant="danger" disabled={confirmEmail.trim().toLowerCase() !== d.user.email.toLowerCase() || reason.trim().length < 5} loading={remove.isPending} onClick={() => remove.mutate()}>Remove permanently</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
