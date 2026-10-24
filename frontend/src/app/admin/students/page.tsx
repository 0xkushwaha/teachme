'use client';
import { PageHeader } from '@/components/ui/primitives';
import { UsersTable } from '@/features/admin/users-table';

export default function AdminStudents() {
  return (
    <>
      <PageHeader title="Students & accounts" description="Search accounts, manage roles, and suspend or reactivate access. Every change is audited." />
      <UsersTable role="STUDENT" />
    </>
  );
}
