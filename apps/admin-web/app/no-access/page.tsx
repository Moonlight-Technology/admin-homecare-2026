'use client';

import { ShieldOff } from 'lucide-react';
import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-provider';

/** A signed-in user without any active platform or clinic membership. */
export default function NoAccessPage() {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <EmptyState
        icon={ShieldOff}
        title="Akun belum memiliki akses"
        description="Akun Anda belum terhubung ke platform atau klinik mana pun. Hubungi admin untuk mendapatkan akses."
        action={<Button variant="secondary" onClick={() => void signOut()}>Keluar</Button>}
      />
    </div>
  );
}
