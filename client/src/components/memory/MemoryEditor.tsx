import { useEffect, useState } from 'react';
import type { MemoryEntry, MemoryKind } from '@shared';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Controls';
import { Modal } from '@/components/ui/Overlay';
import { Note } from '@/components/ui/Panel';
import { api, toApiError } from '@/services/api';

export const MEMORY_KIND_OPTIONS: ReadonlyArray<{ value: MemoryKind; label: string }> = [
  { value: 'fact', label: 'Fact' },
  { value: 'preference', label: 'Preference' },
  { value: 'project', label: 'Project' },
  { value: 'context', label: 'Recurring context' },
  { value: 'relationship', label: 'Relationship' },
];

export function memoryKindLabel(kind: MemoryKind): string {
  return MEMORY_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? 'Fact';
}

export interface MemorySourceDraft {
  conversationId: string;
  messageId: string;
  excerpt: string;
  conversationTitle: string | null;
}

interface MemoryEditorProps {
  open: boolean;
  /** The entry being edited. Omit it to create a new approved memory. */
  entry?: MemoryEntry | null;
  /** Provenance for a memory created from a message. */
  source?: MemorySourceDraft | null;
  defaultContent?: string;
  paused: boolean;
  onClose: () => void;
  onSaved: (entry: MemoryEntry) => void;
}

export function MemoryEditor({
  open,
  entry = null,
  source = null,
  defaultContent = '',
  paused,
  onClose,
  onSaved,
}: MemoryEditorProps): React.JSX.Element {
  const [kind, setKind] = useState<MemoryKind>('fact');
  const [content, setContent] = useState('');
  const [subject, setSubject] = useState('');
  const [reason, setReason] = useState('');
  const [related, setRelated] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<MemoryEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(entry?.kind ?? 'fact');
    setContent(entry?.content ?? defaultContent);
    setSubject(entry?.subject ?? '');
    setReason(entry?.reason ?? '');
    setRelated(entry?.relatedIds ?? []);
    setError(null);
  }, [open, entry, defaultContent]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let alive = true;

    api
      .listMemory({}, controller.signal)
      .then((data) => {
        if (!alive) return;
        setCandidates(data.entries.filter((candidate) => candidate.id !== entry?.id));
      })
      .catch(() => {
        if (alive) setCandidates([]);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [open, entry?.id]);

  const blocked = paused && !entry;
  const sourceExcerpt = entry?.source?.excerpt ?? source?.excerpt ?? null;
  const sourceTitle =
    entry?.source?.conversationTitle ?? source?.conversationTitle ?? null;

  const toggleRelated = (id: string): void => {
    setRelated((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 8) return current;
      return [...current, id];
    });
  };

  const submit = async (): Promise<void> => {
    const nextContent = content.trim();
    if (!nextContent || saving || blocked) return;

    setSaving(true);
    setError(null);
    try {
      const payload = {
        kind,
        content: nextContent,
        subject: subject.trim() || null,
        reason: reason.trim() || null,
        relatedMemoryIds: related,
      };

      const result = entry
        ? await api.updateMemory(entry.id, payload)
        : await api.createMemory({
            ...payload,
            ...(source
              ? {
                  sourceConversationId: source.conversationId,
                  sourceMessageId: source.messageId,
                }
              : {}),
          });

      onSaved(result.entry);
    } catch (cause) {
      setError(toApiError(cause).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} label={entry ? 'Edit memory' : 'Add memory'} width={580}>
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-medium text-ink">
          {entry ? 'Edit approved memory' : 'Approve a memory'}
        </h2>
        <p className="mt-1 text-[11.5px] leading-[1.55] text-ink-3">
          Only what you write here is stored. Nothing is captured automatically.
        </p>
      </div>

      <div className="space-y-3.5 px-4 py-3.5">
        {blocked ? (
          <Note tone="warn" icon={<Icon name="info" size={13} />}>
            Memory is paused. Resume it on the Memory page before adding new entries. Existing
            entries can still be edited.
          </Note>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Kind"
            value={kind}
            onChange={(next) => setKind(next as MemoryKind)}
            options={MEMORY_KIND_OPTIONS}
          />
          <TextField
            label="Subject"
            value={subject}
            maxLength={120}
            placeholder="e.g. Preferred editor"
            onChange={setSubject}
          />
        </div>

        <TextAreaField
          label="Memory"
          value={content}
          rows={4}
          maxLength={2000}
          autoFocus
          placeholder="A fact, preference, project detail, or recurring context CAERA should keep."
          onChange={setContent}
        />

        <TextField
          label="Reason (optional)"
          value={reason}
          maxLength={500}
          placeholder="Why is this worth keeping?"
          onChange={setReason}
        />

        {sourceExcerpt || entry?.source ? (
          <Note icon={<Icon name="history" size={13} />}>
            <span className="text-ink-2">{sourceTitle ?? 'A conversation message'}</span>
            {sourceExcerpt ? (
              <span className="mt-1 block text-[11px] italic leading-[1.55] text-ink-3">
                “{sourceExcerpt}”
              </span>
            ) : null}
            <span className="mt-1 block text-[10px] text-ink-4">
              Source excerpts stay on this device and are never sent to a model provider.
            </span>
          </Note>
        ) : null}

        <div>
          <p className="mb-1.5 text-[12px] text-ink-3">
            Related memories <span className="text-ink-4">optional, up to 8</span>
          </p>
          {candidates.length === 0 ? (
            <p className="text-[11px] leading-[1.5] text-ink-4">
              No other memories to link yet. Relationships help recall pull in context that shares
              no words with your message.
            </p>
          ) : (
            <div className="max-h-[142px] overflow-y-auto rounded-[8px] border border-line bg-raised">
              {candidates.map((candidate) => {
                const checked = related.includes(candidate.id);
                return (
                  <label
                    key={candidate.id}
                    className="flex cursor-pointer items-start gap-2 border-b border-line px-2.5 py-2 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && related.length >= 8}
                      onChange={() => toggleRelated(candidate.id)}
                      className="mt-[3px] size-[12px] shrink-0 accent-[var(--c-accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[11.5px] text-ink-2">
                        {candidate.subject ?? candidate.content.slice(0, 64)}
                      </span>
                      <span className="mt-0.5 block font-mono text-[8.5px] uppercase tracking-[0.05em] text-ink-4">
                        {memoryKindLabel(candidate.kind)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {error ? <p className="text-[11.5px] leading-[1.5] text-danger">{error}</p> : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={saving || blocked || content.trim().length === 0}
          onClick={() => void submit()}
        >
          {saving ? 'Saving…' : entry ? 'Save changes' : 'Store memory'}
        </Button>
      </div>
    </Modal>
  );
}
