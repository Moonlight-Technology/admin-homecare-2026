'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Modal dialog. Full-height sheet on mobile so long forms scroll inside the safe area; centred card from `sm`.
 * Radix traps focus and restores it to the trigger on close (DESIGN.md §8).
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[var(--radius-dialog)] bg-surface shadow-xl outline-none',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85dvh] sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-dialog)]',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-ink">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={cn('mt-0.5 text-sm text-muted', !description && 'sr-only')}>{description ?? title}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-app hover:text-ink" aria-label="Tutup">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
