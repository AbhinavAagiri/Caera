import { isValidElement, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return '';
}

function extractLanguage(node: ReactNode): string | undefined {
  if (!isValidElement<{ className?: string }>(node)) return undefined;
  const match = /language-([\w-]+)/.exec(node.props.className ?? '');
  return match?.[1];
}

export function CodeBlock({
  children,
  code,
  language: languageProp,
}: {
  children?: ReactNode;
  code?: string;
  language?: string;
}): React.JSX.Element {
  const { push } = useToast();
  const [copied, setCopied] = useState(false);

  const childText = useMemo(() => extractText(children).replace(/\n$/, ''), [children]);
  const childLanguage = useMemo(() => extractLanguage(children), [children]);
  const text = code ?? childText;
  const language = languageProp ?? childLanguage;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      push('Copy failed', { detail: 'The browser blocked clipboard access.', tone: 'error' });
    }
  };

  return (
    <div className="overflow-hidden rounded-[6px] border border-line bg-[var(--c-void)]">
      <div className="flex h-[28px] items-center justify-between gap-3 border-b border-line px-2.5">
        <span className="font-mono text-[8px] uppercase tracking-[0.06em] text-ink-4">
          {language ?? 'text'}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className={cn(
            'flex h-[20px] items-center gap-1.5 px-1.5 font-mono text-[8px] uppercase tracking-[0.04em] t-ui',
            copied ? 'text-accent' : 'text-ink-4 hover:bg-raised hover:text-ink-2',
          )}
        >
          <Icon name={copied ? 'check' : 'copy'} size={10} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[10.5px] leading-[1.75] text-ink-2">
        <code>{text}</code>
      </pre>
    </div>
  );
}
