'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Input, Select } from '@/components/ui/form';
import { EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Table } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { formatDateTime } from '@/utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Audit() {
  const { timezone } = useAuth();
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['admin', 'audit', action, entityType, page], queryFn: () => adminService.audit({ action: action || undefined, entityType: entityType || undefined, page, pageSize: 30 }), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Audit log" description="Sensitive and administrative actions, including sign-ins, failed logins and every admin change." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Action prefix" placeholder="Action prefix, e.g. admin. or auth.login" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="sm:max-w-xs" />
        <Select aria-label="Entity" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} className="sm:w-48">
          <option value="">All entities</option>
          {['User', 'TeacherProfile', 'Booking', 'Payment', 'Refund', 'PlatformSetting', 'NotificationTemplate', 'Subject', 'JobRecord', 'CalendarConnection', 'Session', 'SupportTicket'].map((e) => <option key={e}>{e}</option>)}
        </Select>
      </div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : q.isLoading ? <Skeleton className="h-96 rounded-2xl" /> : q.data?.data.length ? (
        <>
          <Table>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
            <tbody>{q.data.data.map((a: any) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap text-[12px]">{formatDateTime(a.createdAt, timezone)}</td>
                <td className="text-[13px]">{a.actor?.fullName ?? 'System'}<p className="text-[11px] text-muted-foreground">{a.ip}</p></td>
                <td className="font-mono text-[12px]">{a.action}</td>
                <td className="font-mono text-[11px]">{a.entityType} {a.entityId?.slice(0, 8)}</td>
                <td className="max-w-sm truncate font-mono text-[11px] text-muted-foreground" title={a.metadata ? JSON.stringify(a.metadata) : ''}>{a.metadata ? JSON.stringify(a.metadata) : ''}</td>
              </tr>))}
            </tbody>
          </Table>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      ) : <EmptyState title="No audit entries match" />}
    </>
  );
}
