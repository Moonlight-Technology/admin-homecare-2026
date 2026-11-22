'use client';

import Link from 'next/link';
import { ArrowLeft, Mail, MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { ApiError, publicPost } from '@/lib/api/client';

/** The reply is the same whether or not the email exists (no account enumeration, AC-SEC-01). */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await publicPost('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Permintaan gagal. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-ink sm:text-xl">Lupa password</h1>
        <p className="mt-1.5 text-sm text-muted">Masukkan email akun Anda. Kami akan mengirim tautan untuk membuat password baru.</p>
      </div>
      {sent ? (
        <Alert tone="success" className="flex items-start gap-2">
          <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Jika email terdaftar, tautan reset sudah dikirim. Tautan hanya berlaku sekali dan untuk waktu terbatas.</span>
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {error && <Alert>{error}</Alert>}
          <FormField label="Email" required>
            {(props) => <Input {...props} icon={Mail} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />}
          </FormField>
          <Button type="submit" className="w-full" loading={submitting} disabled={!email}>Kirim tautan reset</Button>
        </form>
      )}
      <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-500 hover:text-primary-700">
        <ArrowLeft className="size-4" aria-hidden /> Kembali ke halaman masuk
      </Link>
    </div>
  );
}
