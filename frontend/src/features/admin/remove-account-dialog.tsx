'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { Alert } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';

export interface RemovableAccount {
  id: string;
  email: string;
  fullName: string;
}

/** Permanently erases an account's personal data; the admin must re-type the email and give a reason. */
export function RemoveAccountDialog({ account, onClose, onRemoved }: { account: RemovableAccount; onClose: () => void; onRemoved?: () => void }) {
  const qc = useQueryClient();
  const [confirmEmail, setConfirmEmail] = useState('');
  const [reason, setReason] = useState('');
  const remove = useMutation({
    mutationFn: () => adminService.removeUser(account.id, confirmEmail.trim(), reason.trim()),
    onSuccess: () => {
      toast.success('Account deleted and personal data erased');
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'teachers'] });
      onClose();
      onRemoved?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const matches = confirmEmail.trim().toLowerCase() === account.email.toLowerCase();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete ${account.fullName}?`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!matches || reason.trim().length < 5} loading={remove.isPending} onClick={() => remove.mutate()}>Delete permanently</Button></>}
    >
      <div className="space-y-4">
        <Alert tone="danger" title="This permanently erases personal data">Name, email, documents, notifications and calendar connections are deleted. Booking, payment and earnings records are kept without contact details for financial record-keeping. Upcoming sessions must be cancelled first.</Alert>
        <Field label={`Type ${account.email} to confirm`} htmlFor="rm-email"><Input autoComplete="off" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} /></Field>
        <Field label="Reason (audit log)" htmlFor="rm-reason" hint="At least 5 characters"><Input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
