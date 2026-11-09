import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/icons/Icon';

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[20px] w-[34px] shrink-0 rounded-full border t-ui',
        checked ? 'border-transparent bg-accent' : 'border-line-strong bg-elevated',
        disabled && 'opacity-40',
      )}
    >
      <span
        className="absolute left-[2px] top-[2px] block size-[14px] rounded-full transition-transform duration-200 ease-[var(--ease)]"
        style={{
          transform: `translateX(${checked ? 14 : 0}px)`,
          backgroundColor: checked ? 'var(--c-primary-ink)' : 'var(--c-ink-3)',
        }}
      />
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}): React.JSX.Element {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = options[(index + direction + options.length) % options.length];
    if (next && !next.disabled) onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-center gap-[2px] rounded-[8px] border border-line bg-base p-[2px]',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-[6px] border t-ui',
              size === 'sm' ? 'h-[24px] px-2 text-[11px]' : 'h-[26px] px-2.5 text-[12px]',
              active
                ? 'border-line bg-raised text-ink surface-inset'
                : 'border-transparent text-ink-3 hover:text-ink-2',
              option.disabled && 'opacity-40',
            )}
          >
            {option.icon ? <Icon name={option.icon} size={13} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  hideLabel = false,
  value,
  onChange,
  options,
  disabled = false,
  className,
}: {
  label: string;
  hideLabel?: boolean;
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<SelectOption>;
  disabled?: boolean;
  className?: string;
}): React.JSX.Element {
  const id = useId();

  return (
    <div className={cn('relative', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1.5 block text-[12px] text-ink-3'}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-[34px] w-full appearance-none rounded-[8px] border border-line bg-raised pl-2.5 pr-8 text-[12.5px] text-ink t-ui hover:border-line-strong',
          disabled && 'opacity-45',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevronDown"
        size={13}
        className="pointer-events-none absolute bottom-[10px] right-2.5 text-ink-3"
      />
    </div>
  );
}

export function TextAreaField({
  label,
  hideLabel = false,
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 4,
  hint,
  disabled = false,
  autoFocus = false,
  className,
}: {
  label: string;
  hideLabel?: boolean;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  hint?: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}): React.JSX.Element {
  const id = useId();

  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1.5 block text-[12px] text-ink-3'}>
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={rows}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'w-full resize-y rounded-[8px] border border-line bg-raised px-2.5 py-2 text-[12.5px] leading-[1.6] text-ink outline-none t-ui placeholder:text-ink-3 focus:border-line-strong',
          disabled && 'opacity-45',
        )}
      />
      {maxLength || hint ? (
        <div className="mt-1.5 flex items-start justify-between gap-3 text-[11px] leading-[1.5] text-ink-3">
          <div>{hint}</div>
          {maxLength ? (
            <span className="shrink-0 font-mono text-[9.5px] tabular text-ink-4">
              {value.length}/{maxLength}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  hideLabel = false,
  value,
  onChange,
  placeholder,
  maxLength,
  hint,
  disabled = false,
  autoFocus = false,
  className,
  prefix,
  type = 'text',
  autoComplete,
}: {
  label: string;
  hideLabel?: boolean;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  hint?: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  prefix?: ReactNode;
  type?: 'text' | 'password';
  autoComplete?: string;
}): React.JSX.Element {
  const id = useId();

  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1.5 block text-[12px] text-ink-3'}>
        {label}
      </label>
      <div
        className={cn(
          'flex h-[34px] items-center gap-2 rounded-[8px] border border-line bg-raised px-2.5 t-ui focus-within:border-line-strong',
          disabled && 'opacity-45',
        )}
      >
        {prefix ? <span className="shrink-0 text-ink-3">{prefix}</span> : null}
        <input
          id={id}
          type={type}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          maxLength={maxLength}
          placeholder={placeholder}
          autoComplete={autoComplete}
          spellCheck={type === 'password' ? false : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
        />
      </div>
      {hint ? <div className="mt-1.5 text-[11.5px] leading-[1.5] text-ink-3">{hint}</div> : null}
    </div>
  );
}
