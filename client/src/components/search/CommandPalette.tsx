import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Keycap } from '@/components/ui/Indicators';
import { Modal } from '@/components/ui/Overlay';
import { useConversations } from '@/hooks/useConversations';
import { cn } from '@/lib/cn';

interface PaletteItem {
  key: string;
  label: string;
  hint?: string;
  icon: IconName;
  group: 'Conversations' | 'Go to';
  action: () => void;
}

const PAGES: ReadonlyArray<{ label: string; to: string; icon: IconName; hint: string }> = [
  { label: 'New thread', to: '/', icon: 'plus', hint: 'Command deck' },
  { label: 'Agent operations', to: '/agent', icon: 'cpu', hint: 'Plan and execute tools' },
  { label: 'Memory', to: '/memory', icon: 'memory', hint: 'Local memory store' },
  { label: 'Connections', to: '/connections', icon: 'network', hint: 'External applications' },
  { label: 'Obsidian vault', to: '/connections/obsidian', icon: 'folder', hint: 'Local notes' },
  { label: 'Notion pages', to: '/connections/notion', icon: 'globe', hint: 'Connected workspace' },
  { label: 'Logseq graph', to: '/connections/logseq', icon: 'network', hint: 'Local graph' },
  { label: 'Anytype objects', to: '/connections/anytype', icon: 'node', hint: 'Local space' },
  { label: 'Tools and permissions', to: '/tools', icon: 'tools', hint: 'Access control' },
  { label: 'Settings', to: '/settings/general', icon: 'settings', hint: 'General' },
  { label: 'Models & usage', to: '/settings/provider', icon: 'node', hint: 'Settings' },
  { label: 'Voice channel', to: '/settings/voice', icon: 'mic', hint: 'VoiceStudio' },
  { label: 'Appearance', to: '/settings/appearance', icon: 'sun', hint: 'Settings' },
];

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const { conversations } = useConversations(debounced);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 140);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebounced('');
    }
    setActive(0);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [debounced]);

  const items = useMemo<PaletteItem[]>(() => {
    const needle = query.trim().toLowerCase();

    const conversationItems = conversations
      .filter((conversation) => !needle || conversation.title.toLowerCase().includes(needle))
      .slice(0, 7)
      .map<PaletteItem>((conversation) => ({
        key: `c-${conversation.id}`,
        label: conversation.title,
        hint: `${conversation.messageCount} messages`,
        icon: 'chat',
        group: 'Conversations',
        action: () => {
          navigate(`/c/${conversation.id}`);
          onClose();
        },
      }));

    const pageItems = PAGES.filter(
      (page) =>
        !needle ||
        page.label.toLowerCase().includes(needle) ||
        page.hint.toLowerCase().includes(needle),
    ).map<PaletteItem>((page) => ({
      key: `p-${page.to}`,
      label: page.label,
      hint: page.hint,
      icon: page.icon,
      group: 'Go to',
      action: () => {
        navigate(page.to, page.to === '/' ? { state: { focusComposerAt: Date.now() } } : undefined);
        onClose();
      },
    }));

    return [...conversationItems, ...pageItems];
  }, [conversations, navigate, onClose, query]);

  useEffect(() => {
    const element = document.getElementById(`palette-item-${active}`);
    element?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, Math.max(0, items.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      items[active]?.action();
    }
  };

  const grouped: Array<{ group: PaletteItem['group']; items: PaletteItem[] }> = [
    { group: 'Conversations', items: items.filter((item) => item.group === 'Conversations') },
    { group: 'Go to', items: items.filter((item) => item.group === 'Go to') },
  ];

  let flatIndex = -1;

  return (
    <Modal open={open} onClose={onClose} label="Search CAERA" width={580}>
      <div className="flex items-center gap-2.5 border-b border-line px-3.5">
        <Icon name="search" size={16} className="shrink-0 text-ink-3" />
        <input
          data-autofocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search local threads or jump to a surface"
          aria-label="Search local threads"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={items[active] ? `palette-item-${active}` : undefined}
          className="h-[52px] min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3"
        />
        <Keycap>esc</Keycap>
      </div>

      <div id="palette-results" role="listbox" aria-label="Results" className="max-h-[380px] overflow-y-auto p-1.5">
        {items.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-[12.5px] text-ink-2">No matches</p>
            <p className="mt-1 text-[11.5px] text-ink-3">
              Nothing local matches “{query.trim()}”.
            </p>
          </div>
        ) : (
          grouped.map((section) =>
            section.items.length === 0 ? null : (
              <div key={section.group} className="mb-1">
                <p className="px-2 pb-1 pt-2 text-[10.5px] font-medium text-ink-3">{section.group}</p>
                {section.items.map((item) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  const selected = index === active;
                  return (
                    <button
                      key={item.key}
                      id={`palette-item-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActive(index)}
                      onClick={item.action}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-[7px] px-2 py-2 text-left t-ui',
                        selected ? 'bg-raised text-ink' : 'text-ink-2 hover:bg-raised/60',
                      )}
                    >
                      <Icon name={item.icon} size={15} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{item.label}</span>
                      {item.hint ? (
                        <span className="shrink-0 font-mono text-[9.5px] text-ink-3">{item.hint}</span>
                      ) : null}
                      {selected ? (
                        <Icon name="chevronRight" size={12} className="shrink-0 text-ink-3" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ),
          )
        )}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-line px-3.5 py-2">
        <div className="flex items-center gap-3 font-mono text-[9px] text-ink-3">
          <span className="flex items-center gap-1">
            <Keycap>↑</Keycap>
            <Keycap>↓</Keycap>
            move
          </span>
          <span className="flex items-center gap-1">
            <Keycap>↵</Keycap>
            open
          </span>
        </div>
        <span className="font-mono text-[9px] text-ink-3">local index</span>
      </div>
    </Modal>
  );
}
