import { ClipboardCheck, ClipboardList, Hospital } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';

const FEATURES = [
  { icon: Hospital, title: 'Manajemen Klinik', body: 'Kelola profil, layanan, dan operasional klinik.' },
  { icon: ClipboardList, title: 'Kelola Pesanan', body: 'Proses persetujuan dan penugasan nakes.' },
  { icon: ClipboardCheck, title: 'Verifikasi & Monitoring', body: 'Verifikasi klinik dan tenaga kesehatan.' },
];

/**
 * Login layout from reference 01: brand panel + form from tablet up, one column on mobile.
 * No hero photo: the handoff has no licensed image asset, so the panel uses soft brand shapes instead.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-gradient-to-br from-primary-50 via-app to-mint-100">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-mint-100/80 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 size-[28rem] rounded-full bg-primary-50 blur-2xl" />
      <div className="relative mx-auto grid min-h-dvh max-w-6xl items-center gap-10 px-4 py-8 md:grid-cols-[1fr_minmax(0,420px)] md:px-8 desk:gap-16">
        <section className="hidden md:block">
          <Logo />
          <span className="mt-10 flex w-fit items-center rounded-full bg-surface/80 px-3 py-1.5 text-sm font-medium text-primary-700 ring-1 ring-line">Admin Web Platform</span>
          <h1 className="mt-5 max-w-md text-2xl font-bold leading-tight text-ink desk:text-[2.25rem]">Kelola Layanan Kesehatan dengan Lebih Mudah</h1>
          <p className="mt-4 max-w-md text-base text-muted">Platform administrasi Nakes Homecare untuk mengelola klinik, layanan, tenaga kesehatan, dan pesanan layanan homecare.</p>
          <ul className="mt-8 space-y-5">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-surface text-primary-500 ring-1 ring-line"><Icon className="size-5" aria-hidden /></span>
                <span>
                  <span className="block font-semibold text-ink">{title}</span>
                  <span className="block text-sm text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <div className="w-full">
          <div className="mb-6 flex justify-center md:hidden"><Logo /></div>
          <div className="rounded-[var(--radius-dialog)] border border-line bg-surface p-6 shadow-[0_12px_40px_rgba(23,52,59,0.08)] sm:p-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
