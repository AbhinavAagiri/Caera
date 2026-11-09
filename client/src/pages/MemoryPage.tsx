import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MemoryEntry, MemoryKind } from '@shared';
import { Icon } from '@/components/icons/Icon';
import { ModulePage } from '@/components/layout/ModulePage';
import {
  MEMORY_KIND_OPTIONS,
  MemoryEditor,
  memoryKindLabel,
} from '@/components/memory/MemoryEditor';
import { Button, IconButton } from '@/components/ui/Button';
import { SelectField, Switch, TextField } from '@/components/ui/Controls';
import { Chip } from '@/components/ui/Indicators';
import { Modal } from '@/components/ui/Overlay';
import { Note, Panel, PanelHeader, RowGroup, SettingRow } from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { useMemory } from '@/hooks/useMemory';
import { formatRelative, pluralize } from '@/lib/format';
import { toApiError } from '@/services/api';

type KindFilter = 'all' | MemoryKind;

const FILTER_OPTIONS = [
  { value: 'all', label: 'All kinds' },
  ...MEMORY_KIND_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
];

const KIND_TONE: Record<MemoryKind, 'neutral' | 'accent' | 'ok' | 'warn'> = {
  fact: 'neutral',
  preference: 'accent',
  project: 'ok',
  context: 'neutral',
  relationship: 'warn',
};

function MemoryCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: MemoryEntry;
  onEdit: (entry: MemoryEntry) => void;
  onDelete: (entry: MemoryEntry) => void;
}): React.JSX.Element {
  return (
    <article className="border-b border-line px-4 py-3.5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={KIND_TONE[entry.kind]}>{memoryKindLabel(entry.kind)}</Chip>
            {entry.subject ? (
              <h3 className="truncate text-[12px] font-medium text-ink">{entry.subject}</h3>
            ) : null}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-[1.65] text-ink-2">
            {entry.content}
          </p>
          {entry.reason ? (
            <p className="mt-1.5 text-[11px] leading-[1.55] text-ink-3">
              <span className="text-ink-4">Why: </span>
              {entry.reason}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton icon="edit" label="Edit memory" size="sm" onClick={() => onEdit(entry)} />
          <IconButton icon="trash" label="Delete memory" size="sm" onClick={() => onDelete(entry)} />
        </div>
      </div>

      {entry.source ? (
        <div className="mt-2.5 rounded-[5px] border border-line bg-base/50 px-2.5 py-2">
          <p className="font-mono text-[8px] uppercase tracking-[0.07em] text-ink-4">Source</p>
          <p className="mt-1 text-[11px] leading-[1.5] text-ink-3">
            {entry.source.conversationTitle ??
              (entry.source.conversationId ? 'Conversation' : 'Conversation deleted')}
            {entry.source.messageId ? ' · message' : ''}
          </p>
          {entry.source.excerpt ? (
            <p className="mt-1 line-clamp-2 text-[11px] italic leading-[1.55] text-ink-4">
              “{entry.source.excerpt}”
            </p>
          ) : null}
        </div>
      ) : null}

      {entry.related.length > 0 ? (
        <div className="mt-2.5">
          <p className="font-mono text-[8px] uppercase tracking-[0.07em] text-ink-4">Linked</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {entry.related.map((relation) => (
              <span
                key={relation.id}
                className="inline-flex max-w-full items-center gap-1 rounded-[3px] border border-line bg-raised px-1.5 py-0.5 text-[10px] text-ink-3"
              >
                <Icon name="memory" size={9} className="shrink-0 text-ink-4" />
                <span className="truncate">
                  {relation.subject ?? relation.content.slice(0, 48)}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] uppercase tracking-[0.04em] text-ink-4">
        <span>updated {formatRelative(entry.updatedAt)}</span>
        <span>used {pluralize(entry.useCount, 'time')}</span>
        {entry.lastUsedAt ? <span>last {formatRelative(entry.lastUsedAt)}</span> : null}
      </div>
    </article>
  );
}

export function MemoryPage(): React.JSX.Element {
  const navigate = useNavigate();
  const node = useLocalNode();
  const { push } = useToast();

  const [query, setQuery] = useState('');
  const [committedQuery, setCommittedQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MemoryEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemoryEntry | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const memory = useMemory({
    query: committedQuery,
    ...(kind === 'all' ? {} : { kind }),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setCommittedQuery(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  const openCreate = (): void => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (entry: MemoryEntry): void => {
    setEditing(entry);
    setEditorOpen(true);
  };

  const closeEditor = (): void => {
    setEditorOpen(false);
    setEditing(null);
  };

  const saved = (): void => {
    closeEditor();
    memory.refresh();
    node.refresh();
    push(editing ? 'Memory updated' : 'Memory stored', { tone: 'success' });
  };

  const remove = async (): Promise<void> => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await memory.remove(deleteTarget.id);
      node.refresh();
      push('Memory deleted', { detail: 'Removed from this device.', tone: 'success' });
      setDeleteTarget(null);
    } catch (cause) {
      setActionError(toApiError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const count = await memory.clear();
      node.refresh();
      setConfirmClear(false);
      push(`Cleared ${pluralize(count, 'memory', 'memories')}`, { tone: 'success' });
    } catch (cause) {
      setActionError(toApiError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  const togglePaused = async (next: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await memory.setPaused(next);
      node.refresh();
      push(next ? 'Memory paused' : 'Memory resumed', {
        detail: next
          ? 'Existing approved entries remain available for recall.'
          : 'New approved entries can be stored.',
      });
    } catch (cause) {
      setActionError(toApiError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  const filtering = Boolean(committedQuery) || kind !== 'all';
  const statusChip = memory.paused ? (
    <Chip tone="warn">Paused</Chip>
  ) : (
    <Chip tone="ok">Ready</Chip>
  );

  return (
    <ModulePage
      kicker={
        <>
          Local store <span className="slash">/</span> <span className="accent">Memory</span>
        </>
      }
      title="Memory"
      description="Facts, preferences, project notes, and recurring context you approved. Stored in SQLite on this device; only relevant entries reach the routed provider."
      actions={
        <div className="flex items-center gap-2">
          {statusChip}
          <Button size="sm" variant="primary" icon="plus" onClick={openCreate}>
            Add memory
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_302px]">
        <Panel>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <TextField
              hideLabel
              label="Search memories"
              value={query}
              onChange={setQuery}
              placeholder="Search memories"
              maxLength={200}
              prefix={<Icon name="search" size={12} />}
              className="min-w-[180px] flex-1"
            />
            <SelectField
              hideLabel
              label="Filter by kind"
              value={kind}
              onChange={(next) => setKind(next as KindFilter)}
              options={FILTER_OPTIONS}
              className="w-[150px] shrink-0"
            />
          </div>

          <div className="flex items-center justify-between border-b border-line px-4 py-2 font-mono text-[8px] uppercase tracking-[0.08em] text-ink-4">
            <span>
              Archive / {memory.entries.length} shown
              {filtering ? ` of ${memory.total}` : ''}
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="memory" size={10} />
              local only
            </span>
          </div>

          {memory.loading && memory.entries.length === 0 ? (
            <div className="space-y-3 px-4 py-4" aria-hidden="true">
              <div className="h-3 w-[42%] animate-pulse rounded bg-raised" />
              <div className="h-3 w-[86%] animate-pulse rounded bg-raised" />
              <div className="h-3 w-[68%] animate-pulse rounded bg-raised" />
              <div className="h-3 w-[30%] animate-pulse rounded bg-raised" />
            </div>
          ) : memory.error ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-12 text-center">
              <span className="mb-3 text-danger">
                <Icon name="warning" size={20} />
              </span>
              <p className="font-serif text-[22px] leading-tight text-ink">Memory unavailable</p>
              <p className="mt-1.5 max-w-[42ch] text-[11.5px] leading-[1.6] text-ink-3">
                {memory.error.message}
              </p>
              <Button
                size="sm"
                variant="secondary"
                icon="refresh"
                className="mt-4"
                onClick={memory.refresh}
              >
                Retry
              </Button>
            </div>
          ) : memory.entries.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-14 text-center">
              <div className="relative mb-5 grid size-[76px] place-items-center rounded-full border border-line">
                <span
                  className="absolute inset-[6px] rounded-full border border-dashed border-line"
                  aria-hidden="true"
                />
                <span
                  className="absolute inset-[16px] rounded-full border border-line"
                  aria-hidden="true"
                />
                <span className="font-mono text-[20px] tabular text-ink-2">{memory.total}</span>
              </div>
              <p className="font-serif text-[24px] leading-tight text-ink">
                {filtering ? 'No matching memories' : 'Nothing stored'}
              </p>
              <p className="mx-auto mt-1.5 max-w-[42ch] text-[11.5px] leading-[1.7] text-ink-3">
                {filtering
                  ? 'Try another search or kind filter. The full store is unchanged.'
                  : 'Nothing is captured automatically. Approve a fact, preference, or project note and it will appear here.'}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {filtering ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setQuery('');
                      setCommittedQuery('');
                      setKind('all');
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" icon="plus" onClick={openCreate}>
                    Add the first memory
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div>
              {memory.error ? (
                <p className="border-b border-line px-4 py-2 text-[10.5px] text-warn">
                  Refresh failed. Showing the last local result.
                </p>
              ) : null}
              {memory.entries.map((entry) => (
                <MemoryCard
                  key={entry.id}
                  entry={entry}
                  onEdit={openEdit}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title="Collection"
              action={
                <Switch
                  label="Pause new memory entries"
                  checked={memory.paused}
                  disabled={busy}
                  onChange={(next) => void togglePaused(next)}
                />
              }
            />
            <RowGroup>
              <SettingRow label="New entries" description="Paused entries stay editable.">
                <span className="font-mono text-[10.5px] text-ink-3">
                  {memory.paused ? 'paused' : 'allowed'}
                </span>
              </SettingRow>
              <SettingRow label="Stored" description="All approved entries on this device.">
                <span className="font-mono text-[10.5px] text-ink-3">
                  {pluralize(memory.total, 'entry', 'entries')}
                </span>
              </SettingRow>
              <SettingRow
                label="Clear memory store"
                description="Removes every approved entry. Conversations are untouched."
              >
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy || memory.total === 0}
                  onClick={() => setConfirmClear(true)}
                >
                  Clear all
                </Button>
              </SettingRow>
            </RowGroup>
          </Panel>

          <Panel>
            <PanelHeader title="Retrieval and disclosure" />
            <RowGroup>
              <SettingRow label="Sent to the routed provider" description="Per reply, only when relevant.">
                <span className="font-mono text-[10.5px] text-ink-3">6 + 2 linked</span>
              </SettingRow>
              <SettingRow label="Text budget">
                <span className="font-mono text-[10.5px] text-ink-3">1,800 chars</span>
              </SettingRow>
              <SettingRow label="Excerpts and reasons">
                <span className="font-mono text-[10.5px] text-ink-3">stay local</span>
              </SettingRow>
            </RowGroup>
            <div className="border-t border-line px-4 py-3">
              <p className="text-[11px] leading-[1.65] text-ink-3">
                Before a reply, CAERA scores your message against the local store and includes only
                the best matches as part of the selected model's system instruction. The rest of the store,
                source excerpts, and your reasons never leave this device.
              </p>
            </div>
          </Panel>

          <Note icon={<Icon name="shield" size={13} />}>
            Memory is written to SQLite on this machine. Nothing is captured automatically; every
            entry exists because you approved it. You can edit or delete any entry at any time.
          </Note>

          <Button
            size="sm"
            variant="ghost"
            icon="settings"
            onClick={() => navigate('/settings/memory')}
          >
            Memory settings
          </Button>
        </div>
      </div>

      {actionError ? (
        <p className="mt-3 rounded-[5px] border border-[color-mix(in_oklab,var(--c-danger)_24%,transparent)] bg-[color-mix(in_oklab,var(--c-danger)_7%,transparent)] px-3 py-2 text-[11.5px] text-danger">
          {actionError}
        </p>
      ) : null}

      <MemoryEditor
        open={editorOpen}
        entry={editing}
        paused={memory.paused}
        onClose={closeEditor}
        onSaved={saved}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        label="Delete memory"
        width={440}
      >
        <div className="px-4 py-3.5">
          <h2 className="text-[13.5px] font-medium text-ink">Delete this memory?</h2>
          <p className="mt-1.5 text-[12px] leading-[1.6] text-ink-3">
            “{deleteTarget?.subject ?? deleteTarget?.content.slice(0, 80)}” will be removed from
            this device. This cannot be undone.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? 'Deleting…' : 'Delete memory'}
          </Button>
        </div>
      </Modal>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        label="Clear all memories"
        width={440}
      >
        <div className="px-4 py-3.5">
          <h2 className="text-[13.5px] font-medium text-ink">Clear all memories?</h2>
          <p className="mt-1.5 text-[12px] leading-[1.6] text-ink-3">
            {pluralize(memory.total, 'approved entry', 'approved entries')} will be removed from
            this device. Conversations and settings are kept. This cannot be undone.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void clearAll()}>
            {busy ? 'Clearing…' : 'Clear everything'}
          </Button>
        </div>
      </Modal>
    </ModulePage>
  );
}
