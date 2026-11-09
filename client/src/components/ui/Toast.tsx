import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/icons/Icon';

type ToastTone = 'neutral' | 'success' | 'warning' | 'error';

interface ToastOptions {
  detail?: string;
  tone?: ToastTone;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
  message: string;
}

interface ToastValue {
  push: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastValue | null>(null);
const MAX_TOASTS = 4;

const toneClass: Record<ToastTone, string> = {
  neutral: 'bg-[var(--c-ink-3)]',
  success: 'bg-[var(--c-ok)]',
  warning: 'bg-[var(--c-warn)]',
  error: 'bg-[var(--c-danger)]',
};

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = crypto.randomUUID();
      setItems((current) => [...current.slice(-(MAX_TOASTS - 1)), { id, message, ...options }]);
      const timer = window.setTimeout(() => dismiss(id), options.duration ?? 4200);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) window.clearTimeout(timer);
    };
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[calc(100vw-32px)] max-w-[336px] flex-col gap-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="pointer-events-auto flex items-start gap-2.5 rounded-[9px] border border-line bg-surface px-3 py-2.5 panel-shadow"
            style={{ animation: 'toast-in 220ms var(--ease) both' }}
          >
            <span
              className={cn(
                'mt-[6px] size-[5px] shrink-0 rounded-full',
                toneClass[item.tone ?? 'neutral'],
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] leading-[1.45] text-ink">{item.message}</p>
              {item.detail ? (
                <p className="mt-0.5 text-[11.5px] leading-[1.5] text-ink-3">{item.detail}</p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(item.id)}
              className="mt-[1px] grid size-[20px] place-items-center rounded-[4px] text-ink-3 t-ui hover:bg-raised hover:text-ink"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
