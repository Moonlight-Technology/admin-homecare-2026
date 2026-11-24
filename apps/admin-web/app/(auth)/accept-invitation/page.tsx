'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { FormField, PasswordInput } from '@/components/ui/input';
import { ApiError, publicPost } from '@/lib/api/client';

function InvitationForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || password.length < 10 || confirm !== password) return;
    setError('');
    setSubmitting(true);
    try {
      await publicPost<void>('/auth/accept-invitation', { token, password });
      setPassword('');
      setConfirm('');
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Aktivasi akun gagal. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) return <Alert>Tautan undangan tidak lengkap. Minta admin mengirim ulang undangan aktivasi.</Alert>;
  if (done) return <div className="space-y-5"><Alert tone="success">Akun berhasil diaktifkan. Silakan masuk dengan password yang baru dibuat. Aktivasi akun tidak mengubah status verifikasi klinik.</Alert><Button asChild className="w-full"><Link href="/login">Ke halaman masuk</Link></Button></div>;
  return (
    <form onSubmit={submit} className="space-y-5">
      <div><h1 className="text-lg font-bold text-ink">Aktivasi akun</h1><p className="mt-1.5 text-sm text-muted">Buat password minimal 10 karakter. Undangan hanya dapat digunakan sekali.</p></div>
      {error && <Alert>{error}</Alert>}
      <FormField label="Password baru" required error={password.length > 0 && password.length < 10 ? 'Minimal 10 karakter.' : undefined}>{(props) => <PasswordInput {...props} autoComplete="new-password" required minLength={10} maxLength={200} disabled={submitting} value={password} onChange={(event) => setPassword(event.target.value)} />}</FormField>
      <FormField label="Ulangi password" required error={mismatch ? 'Password tidak sama.' : undefined}>{(props) => <PasswordInput {...props} autoComplete="new-password" required maxLength={200} disabled={submitting} value={confirm} onChange={(event) => setConfirm(event.target.value)} />}</FormField>
      <Button type="submit" className="w-full" loading={submitting} disabled={password.length < 10 || !confirm || mismatch}>Aktifkan akun</Button>
    </form>
  );
}

export default function AcceptInvitationPage() {
  return <Suspense><InvitationForm /></Suspense>;
}
