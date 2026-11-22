'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ className, children, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content align="end" sideOffset={8} className={cn('z-50 min-w-56 rounded-[var(--radius-card)] border border-line bg-surface p-1.5 shadow-lg', className)} {...props}>
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn('flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-md px-2.5 text-sm text-ink outline-none data-[highlighted]:bg-primary-50 [&_svg]:size-4 [&_svg]:text-muted', className)} {...props} />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 py-2">{children}</div>;
}

export const DropdownMenuSeparator = () => <Menu.Separator className="my-1 h-px bg-line" />;
