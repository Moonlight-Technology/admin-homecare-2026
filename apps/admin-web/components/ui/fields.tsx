'use client';

import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const control = 'w-full rounded-[var(--radius-input)] border bg-surface text-sm text-ink outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-50 disabled:bg-app disabled:text-muted';

/** Native select: accessible and mobile-friendly by default. */
export function Select({ className, invalid, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <div className="relative">
      <select {...props} aria-invalid={invalid || undefined} className={cn(control, 'h-11 appearance-none pl-3 pr-9', invalid ? 'border-danger' : 'border-line', className)}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function Textarea({ className, invalid, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea {...props} aria-invalid={invalid || undefined} className={cn(control, 'min-h-24 px-3 py-2.5', invalid ? 'border-danger' : 'border-line', className)} />;
}

/** On/off switch with a visible label; the whole row is the 44px touch target. */
export function Switch({ checked, onCheckedChange, label, description, disabled, id }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; description?: string; disabled?: boolean; id?: string }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-4 rounded-[var(--radius-input)] text-left disabled:opacity-55"
    >
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <span className={cn('relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-primary-500' : 'bg-line')}>
        <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}
