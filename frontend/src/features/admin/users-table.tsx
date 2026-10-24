'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { EmptyState, ErrorState, Pagination, Skeleton, StatusBadge, Table } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { relative } from '@/utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function UsersTable({ role }: { role?: 'STUDENT' | 'ADMIN' }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [roleFilter, setRoleFilter] = useState(role ?? '');
  const [action, setAction] = useState<{ user: any; status: string } | null>(null);
  const [reason, setReason] = useState('');
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
                  <td><p className="font-medium">{u.fullName}</p><p className="text-[12px] text-muted-foreground">{u.email}</p></td>
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
    </div>
  );
}
