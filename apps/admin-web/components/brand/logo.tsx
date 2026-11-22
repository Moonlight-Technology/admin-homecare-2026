import { cn } from '@/lib/cn';

/**
 * PLACEHOLDER mark drawn from the reference concepts (house + heart). Replace with the official Nakes Homecare
 * logo file once the brand owner supplies it; no brand asset was included in the handoff.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn('size-9', className)} aria-hidden>
      <path d="M20 3 4 15v17a5 5 0 0 0 5 5h22a5 5 0 0 0 5-5V15L20 3Z" fill="var(--color-primary-500)" />
      <path d="M20 29s-8-4.7-8-10.2A4.4 4.4 0 0 1 20 16a4.4 4.4 0 0 1 8 2.8C28 24.3 20 29 20 29Z" fill="#fff" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && (
        <span className="leading-none">
          <span className="block text-lg font-bold text-primary-700">Nakes</span>
          <span className="block text-sm font-medium text-primary-500">Homecare</span>
        </span>
      )}
    </span>
  );
}
