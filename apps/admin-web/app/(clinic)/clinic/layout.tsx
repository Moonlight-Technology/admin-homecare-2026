import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';

export default function ClinicLayout({ children }: { children: ReactNode }) {
  return <AppShell area="clinic">{children}</AppShell>;
}
