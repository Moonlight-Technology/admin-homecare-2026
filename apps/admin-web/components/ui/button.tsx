import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-input)] text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-4',
  {
    variants: {
      variant: {
        primary: 'bg-primary-500 text-white hover:bg-primary-700',
        secondary: 'border border-line bg-surface text-ink hover:bg-app',
        ghost: 'text-muted hover:bg-primary-50 hover:text-ink',
        destructive: 'bg-danger text-white hover:bg-danger/90',
        soft: 'bg-primary-50 text-primary-700 hover:bg-mint-100',
      },
      // 44px minimum touch target (DESIGN.md §3); `sm` is for dense desktop toolbars only.
      size: { md: 'h-11 px-4', sm: 'h-9 px-3', icon: 'size-11' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean };

export function Button({ className, variant, size, asChild, loading, disabled, children, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component className={cn(buttonVariants({ variant, size }), className)} disabled={asChild ? undefined : disabled || loading} aria-busy={loading || undefined} {...props}>
      {asChild ? children : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Component>
  );
}
