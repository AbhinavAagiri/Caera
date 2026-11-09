import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type StatusTone = 'online' | 'offline' | 'pending' | 'error' | 'accent' | 'muted';

const toneClass: Record<StatusTone, string> = {
  online: 'bg-[var(--c-ok)]',
  offline: 'bg-[var(--c-ink-3)]',
  pending: 'bg-[var(--c-warn)]',
  error: 'bg-[var(--c-danger)]',
  accent: 'bg-[var(--c-accent)]',
  muted: 'bg-[var(--c-ink-3)]',
};

export function StatusDot({
  tone = 'muted',
  className,
  label,
}: {
  tone?: StatusTone;
  className?: string;
  label?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={cn('inline-block size-[5px] shrink-0 rounded-full', toneClass[tone], className)}
    />
  );
}

export function Keycap({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-[3px] border border-line bg-raised px-1 font-mono text-[8.5px] leading-none text-ink-4">
      {children}
    </kbd>
  );
}

type ChipTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const chipTone: Record<ChipTone, string> = {
  neutral: 'border-line bg-raised text-ink-3',
  accent: 'border-[color-mix(in_oklab,var(--c-accent)_28%,transparent)] bg-accent-soft text-accent',
  ok: 'border-[color-mix(in_oklab,var(--c-ok)_28%,transparent)] bg-[color-mix(in_oklab,var(--c-ok)_9%,transparent)] text-ok',
  warn: 'border-[color-mix(in_oklab,var(--c-warn)_30%,transparent)] bg-[color-mix(in_oklab,var(--c-warn)_9%,transparent)] text-warn',
  danger:
    'border-[color-mix(in_oklab,var(--c-danger)_28%,transparent)] bg-[color-mix(in_oklab,var(--c-danger)_9%,transparent)] text-danger',
};

export function Chip({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: ChipTone;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex min-h-[20px] items-center gap-1.5 rounded-[4px] border px-2 font-mono text-[8.5px] leading-tight tracking-[0.01em]',
        chipTone[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
