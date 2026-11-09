import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <section
      className={cn(
        'caera-panel overflow-hidden rounded-[7px] border border-line bg-surface surface-inset',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="caera-panel-head flex items-start justify-between gap-4 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h3 className="text-[12px] font-medium tracking-[-0.008em] text-ink-2">
          {title}
        </h3>
        {description ? (
          <p className="mt-1.5 max-w-[62ch] text-[11.5px] leading-[1.6] text-ink-3">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function RowGroup({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="divide-y divide-line">{children}</div>;
}

export function SettingRow({
  label,
  description,
  children,
  className,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'caera-setting-row flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0 max-w-[54ch]">
        <p className="text-[12px] text-ink">{label}</p>
        {description ? (
          <p className="mt-0.5 text-[11px] leading-[1.55] text-ink-3">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  aside,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="caera-section-heading mb-3.5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[14px] font-medium tracking-[-0.012em] text-ink">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-[68ch] text-[11.5px] leading-[1.65] text-ink-3">{description}</p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

export function Note({
  children,
  tone = 'neutral',
  icon,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warn' | 'danger';
  icon?: ReactNode;
}): React.JSX.Element {
  const toneClass =
    tone === 'accent'
      ? 'border-[color-mix(in_oklab,var(--c-accent)_22%,transparent)] bg-accent-soft'
      : tone === 'warn'
        ? 'border-[color-mix(in_oklab,var(--c-warn)_24%,transparent)] bg-[color-mix(in_oklab,var(--c-warn)_7%,transparent)]'
        : tone === 'danger'
          ? 'border-[color-mix(in_oklab,var(--c-danger)_24%,transparent)] bg-[color-mix(in_oklab,var(--c-danger)_7%,transparent)]'
          : 'border-line bg-raised/60';

  return (
    <div className={cn('caera-note flex gap-2.5 rounded-[5px] border px-3 py-2.5', toneClass)}>
      {icon ? <div className="mt-[1px] shrink-0 text-ink-4">{icon}</div> : null}
      <div className="text-[11px] leading-[1.65] text-ink-3">{children}</div>
    </div>
  );
}
