'use client';

import { useState } from 'react';
import { Alert } from '@/components/feedback/states';
import { Button } from './button';
import { Dialog } from './dialog';
import { Textarea } from './fields';
import { FormField } from './input';

const MIN_LENGTH = 5;

/** Action that needs a written reason (reject, request revision, suspend). The API enforces the same minimum. */
export function ReasonDialog({ open, onOpenChange, title, description, label, confirmLabel, destructive, loading, error, maxLength = 2000, hint, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  error?: string;
  maxLength?: number;
  hint?: string;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < MIN_LENGTH;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !loading && onOpenChange(next)}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
          <Button variant={destructive ? 'destructive' : 'primary'} disabled={tooShort} loading={loading} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <FormField label={label} required hint={hint ?? `Minimal ${MIN_LENGTH} karakter. Akan ditampilkan ke klinik dan tersimpan di riwayat.`}>
          {(props) => <Textarea {...props} autoFocus value={reason} maxLength={maxLength} onChange={(event) => setReason(event.target.value)} />}
        </FormField>
      </div>
    </Dialog>
  );
}
