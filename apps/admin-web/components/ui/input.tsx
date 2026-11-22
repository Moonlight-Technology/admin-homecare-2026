'use client';

import { Eye, EyeOff, type LucideIcon } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; icon?: LucideIcon };

export function Input({ className, invalid, icon: Icon, ...props }: InputProps) {
  return (
    <div className="relative">
      {Icon && <Icon aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />}
      <input
        {...props}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-11 w-full rounded-[var(--radius-input)] border bg-surface px-3 text-sm text-ink outline-none transition placeholder:text-muted/80 focus:border-primary-500 focus:ring-2 focus:ring-primary-50 disabled:bg-app',
          invalid ? 'border-danger' : 'border-line',
          Icon && 'pl-10',
          className,
        )}
      />
    </div>
  );
}

/** Password input with an accessible show/hide toggle (DESIGN.md §6.1). */
export function PasswordInput({ icon, ...props }: Omit<InputProps, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} icon={icon} type={visible ? 'text' : 'password'} className="pr-11" />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? 'Sembunyikan password' : 'Tampilkan password'}
        aria-pressed={visible}
        className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-r-[var(--radius-input)] text-muted hover:text-ink"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** Label, control, and its error/hint, wired with aria-describedby. */
export function FormField({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: (props: { id: string; 'aria-describedby'?: string; invalid: boolean }) => ReactNode }) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children({ id, 'aria-describedby': message ? messageId : undefined, invalid: Boolean(error) })}
      {message && <p id={messageId} className={cn('text-xs', error ? 'text-danger' : 'text-muted')}>{message}</p>}
    </div>
  );
}
