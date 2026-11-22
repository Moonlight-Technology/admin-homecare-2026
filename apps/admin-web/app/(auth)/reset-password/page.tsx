'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { FormField, PasswordInput } from '@/components/ui/input';
import { ApiError, publicPost } from '@/lib/api/client';

const MIN_LENGTH = 10;

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_LENGTH || mismatch) return;
    setError('');
    setSubmitting(true);
    try {
      await publicPost('/auth/reset-password', { token, password });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Reset password gagal. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) return <Alert>Tautan reset tidak lengkap. Minta tautan baru dari halaman lupa password.</Alert>;
  if (done) {
    return (
      <div className="space-y-5">
        <Alert tone="success">Password berhasil diubah. Semua sesi lama sudah dikeluarkan; silakan masuk dengan password baru.</Alert>
        <Button asChild className="w-full"><Link href="/login">Ke halaman masuk</Link></Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-ink sm:text-xl">Buat password baru</h1>
        <p className="mt-1.5 text-sm text-muted">Gunakan minimal {MIN_LENGTH} karakter.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      <FormField label="Password baru" required error={tooShort ? `Minimal ${MIN_LENGTH} karakter.` : undefined}>
        {(props) => <PasswordInput {...props} icon={Lock} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} />}
      </FormField>
      <FormField label="Ulangi password" required error={mismatch ? 'Password tidak sama.' : undefined}>
        {(props) => <PasswordInput {...props} icon={Lock} autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} />}
      </FormField>
      <Button type="submit" className="w-full" loading={submitting} disabled={password.length < MIN_LENGTH || mismatch || !confirm}>Simpan password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
