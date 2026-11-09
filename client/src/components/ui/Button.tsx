import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/icons/Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const variantClass: Record<Variant, string> = {
  primary: 'caera-button-primary',
  secondary: 'caera-button-secondary',
  ghost: 'caera-button-ghost',
  danger: 'caera-button-danger',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-7 rounded-[4px] px-2.5 text-[11.5px] gap-1.5',
  md: 'h-[32px] rounded-[5px] px-3 text-[12px] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  trailingIcon?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, trailingIcon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'caera-button inline-flex select-none items-center justify-center whitespace-nowrap border font-medium tracking-[-0.005em]',
        't-ui active:scale-[0.995] disabled:pointer-events-none disabled:opacity-40',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 13 : 14} /> : null}
      {children}
      {trailingIcon ? <Icon name={trailingIcon} size={size === 'sm' ? 12 : 13} /> : null}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', active = false, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'caera-icon-button grid shrink-0 place-items-center rounded-[4px] border t-ui active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'size-[26px]' : 'size-[29px]',
        active
          ? 'border-line-strong bg-elevated text-ink'
          : 'border-transparent text-ink-3 hover:bg-raised hover:text-ink',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 15} />
    </button>
  );
});
