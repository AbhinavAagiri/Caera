import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

function useDialogBehaviour(
  ref: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;

    const node = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTarget = (): void => {
      const target =
        node?.querySelector<HTMLElement>('[data-autofocus]') ??
        node?.querySelector<HTMLElement>('input, textarea, select') ??
        node;
      target?.focus();
    };
    const raf = requestAnimationFrame(focusTarget);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !node) return;

      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [active, onClose, ref]);
}

export function Modal({
  open,
  onClose,
  label,
  children,
  width = 560,
  className,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  width?: number;
  className?: string;
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehaviour(ref, onClose, open);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto p-4 pt-[8vh] sm:pt-[12vh]">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="caera-scrim fixed inset-0 bg-[var(--c-overlay)]"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={{ maxWidth: width }}
        className={cn(
          'caera-modal enter-rise relative w-full rounded-[7px] border border-line-strong bg-surface panel-shadow outline-none',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  label,
  side = 'left',
  width = 320,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  side?: 'left' | 'right';
  width?: number;
  children: ReactNode;
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehaviour(ref, onClose, open);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[54]">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="caera-scrim absolute inset-0 bg-[var(--c-overlay)]"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={{
          width,
          animation: `drawer-in-${side === 'left' ? 'left' : 'right'} 220ms var(--ease) both`,
        }}
        className={cn(
          'caera-drawer absolute inset-y-0 max-w-[86vw] border-line bg-base outline-none',
          side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
