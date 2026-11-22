'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Side drawer (mobile navigation, filter sheets). Focus is trapped and restored by Radix. */
export function Sheet({ open, onOpenChange, title, side = 'left', children, className }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; side?: 'left' | 'right' | 'bottom'; children: ReactNode; className?: string }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className={cn(
            'fixed z-50 flex flex-col bg-surface shadow-xl outline-none',
            side === 'left' && 'inset-y-0 left-0 w-[min(84vw,300px)] pb-[env(safe-area-inset-bottom)]',
            side === 'right' && 'inset-y-0 right-0 w-[min(90vw,380px)] pb-[env(safe-area-inset-bottom)]',
            side === 'bottom' && 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[var(--radius-dialog)] pb-[env(safe-area-inset-bottom)]',
            className,
          )}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <Dialog.Close className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-md text-muted hover:bg-app hover:text-ink" aria-label="Tutup">
            <X className="size-5" />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
