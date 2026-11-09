import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Overlay';
import { useConversations } from '@/hooks/useConversations';
import { formatRelative, pluralize } from '@/lib/format';

export function HistoryDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const { conversations, loading, error, reload } = useConversations(debounced);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 160);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setDebounced('');
    }
  }, [open]);

  const openThread = (id: string): void => {
    navigate(`/c/${id}`);
    onClose();
  };

  const newThread = (): void => {
    navigate('/', { state: { focusComposerAt: Date.now() } });
    onClose();
  };

  return (
    <Drawer open={open} onClose={onClose} label="Conversation history" side="left" width={360}>
      <div className="history-panel">
        <div className="history-head">
          <div>
            <h2>Conversations</h2>
            <p>Local index / {pluralize(conversations.length, 'thread')}</p>
          </div>
          <IconButton icon="close" label="Close history" size="sm" onClick={onClose} />
        </div>

        <div className="px-3 pt-3">
          <button type="button" onClick={newThread} className="history-new">
            <Icon name="plus" size={14} />
            <span>New thread</span>
            <span className="ml-auto font-mono text-[7px] text-ink-4">CTRL N</span>
          </button>

          <div className="history-search">
            <Icon name="search" size={13} className="shrink-0 text-ink-4" aria-hidden="true" />
            <input
              data-autofocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search local conversations"
              aria-label="Search conversations"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="text-ink-4 transition-colors hover:text-ink-2"
              >
                <Icon name="close" size={11} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="history-list">
          {loading && conversations.length === 0 ? (
            <div className="space-y-2 px-2 py-3" aria-hidden="true">
              {[72, 56, 64].map((width) => (
                <div key={width} className="space-y-2 border border-line px-2 py-2.5">
                  <div className="h-[8px] bg-raised" style={{ width: `${width}%` }} />
                  <div className="h-[6px] w-1/2 bg-raised" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="history-empty">
              <p>{error.message}</p>
              <Button size="sm" variant="secondary" icon="refresh" className="mt-3" onClick={reload}>
                Retry
              </Button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="history-empty">
              <Icon name="chat" size={18} className="mx-auto mb-2 text-ink-4" />
              {search.trim()
                ? `No local thread matches “${search.trim()}”.`
                : 'No threads yet. The next command starts the local record.'}
            </div>
          ) : (
            <>
              <p className="history-group">Local threads</p>
              <ul>
                {conversations.map((conversation) => {
                  const active = location.pathname === `/c/${conversation.id}`;
                  return (
                    <li key={conversation.id}>
                      <button
                        type="button"
                        onClick={() => openThread(conversation.id)}
                        data-active={active}
                        aria-current={active ? 'page' : undefined}
                        className="history-row"
                      >
                        <span className="history-title">{conversation.title}</span>
                        <span className="history-preview">
                          {conversation.preview || 'No stored messages yet.'}
                        </span>
                        <span className="history-meta">
                          <span>{conversation.messageCount} msg</span>
                          <span aria-hidden="true" className="text-line-strong">
                            /
                          </span>
                          <span>{formatRelative(conversation.updatedAt)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="history-foot">
          <span>device / local json</span>
          <span>{loading ? 'syncing' : 'no sync'}</span>
        </div>
      </div>
    </Drawer>
  );
}
