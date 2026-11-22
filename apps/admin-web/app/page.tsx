'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FullPageLoader } from '@/components/feedback/states';
import { useAuth } from '@/lib/auth/auth-provider';
import { homePath } from '@/lib/auth/types';

/** Sends each user to their own area once the session is known. */
export default function HomePage() {
  const { status, me } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signed-out') router.replace('/login');
    else if (status === 'signed-in' && me) router.replace(homePath(me));
  }, [status, me, router]);
  return <FullPageLoader />;
}
