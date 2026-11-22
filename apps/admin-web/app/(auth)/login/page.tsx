'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, LogIn, Mail, ShieldCheck } from 'lucide-react';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { LogoMark } from '@/components/brand/logo';
import { Alert } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { FormField, Input, PasswordInput } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-provider';
import { homePath } from '@/lib/auth/types';

/** Only same-site paths, so `?next=` cannot send users to another site. */
const safeNext = (value: string | null) => (value && value.startsWith('/') && !value.startsWith('//') ? value : null);

/**
 * Email/password only (spec §8). No social sign-in, role switch, or "remember me": the destination comes from
 * the account's memberships, and the auth policy defines session length.
 */
function LoginForm() {
  const { status, me, signIn } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'signed-in' && me) router.replace(next ?? homePath(me));
  }, [status, me, next, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    setSubmitting(true);
    try {
      const profile = await signIn(email.trim(), password);
      router.replace(next ?? homePath(profile));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VALIDATION_FAILED') setFieldErrors(cause.fieldErrors);
      else setError(cause instanceof ApiError ? cause.message : 'Tidak dapat masuk. Periksa koneksi lalu coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="text-center">
        <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary-50"><LogoMark className="size-9" /></span>
        <h1 className="text-lg font-bold text-ink sm:text-xl">Masuk ke Nakes Homecare</h1>
        <p className="mt-1.5 text-sm text-muted">Akses dashboard admin untuk mengelola layanan dan operasional.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      <FormField label="Email" required error={fieldErrors.email?.[0]}>
        {(props) => <Input {...props} icon={Mail} type="email" autoComplete="username" placeholder="nama@klinik.co.id" required value={email} onChange={(event) => setEmail(event.target.value)} />}
      </FormField>
      <FormField label="Password" required error={fieldErrors.password?.[0]}>
        {(props) => <PasswordInput {...props} icon={Lock} autoComplete="current-password" placeholder="Masukkan password" required value={password} onChange={(event) => setPassword(event.target.value)} />}
      </FormField>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm font-semibold text-primary-500 hover:text-primary-700">Lupa password?</Link>
      </div>
      <Button type="submit" className="w-full" loading={submitting} disabled={!email || !password}>
        {!submitting && <LogIn aria-hidden />} Masuk
      </Button>
      <p className="text-center text-sm text-muted">
        Klinik belum terdaftar? <Link href="/register/clinic" className="font-semibold text-primary-700 hover:text-primary-500">Daftarkan klinik</Link>
      </p>
      <p className="flex items-start gap-2.5 rounded-[var(--radius-input)] bg-app px-3.5 py-3 text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary-500" aria-hidden />
        Hanya untuk admin platform dan klinik yang terdaftar di Nakes Homecare.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
