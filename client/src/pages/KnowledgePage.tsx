import { useEffect, useState, type FormEvent } from 'react';
import type {
  KnowledgeSearchResult,
  KnowledgeSourceRules,
  KnowledgeSourceSummary,
} from '@shared';
import { Icon } from '@/components/icons/Icon';
import { ModulePage } from '@/components/layout/ModulePage';
import { Button, IconButton } from '@/components/ui/Button';
import { SelectField, Switch, TextAreaField, TextField } from '@/components/ui/Controls';
import { Chip } from '@/components/ui/Indicators';
import { Modal } from '@/components/ui/Overlay';
import { Note, Panel, PanelHeader } from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { useKnowledge } from '@/hooks/useKnowledge';
import { formatRelative, pluralize } from '@/lib/format';
import { toApiError } from '@/services/api';

const SOURCE_STATUS: Record<
  KnowledgeSourceSummary['status'],
  { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' }
> = {
  'not-connected': { label: 'Not connected', tone: 'neutral' },
  'permission-required': { label: 'Read blocked', tone: 'warn' },
  disabled: { label: 'Not indexing', tone: 'neutral' },
  unsupported: { label: 'Unsupported', tone: 'neutral' },
  'never-indexed': { label: 'Not synced', tone: 'warn' },
  indexed: { label: 'Indexed', tone: 'ok' },
  error: { label: 'Needs attention', tone: 'danger' },
};

function lines(value: string[]): string {
  return value.join('\n');
}

function parseLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean))].slice(
    0,
    100,
  );
}

function sourceDetail(source: KnowledgeSourceSummary): string {
  if (source.status === 'not-connected') return 'Connect this application in Connections first.';
  if (source.status === 'permission-required') return 'Grant read access in Connections, then sync.';
  if (!source.supportsIndexing) return 'This connector does not expose searchable documents.';
  if (!source.indexingEnabled) return 'Enable indexing for this source, save, then run Sync.';
  if (source.lastIndexedAt) {
    return `${pluralize(source.documents, 'document')} · ${pluralize(source.chunks, 'chunk')} · indexed ${formatRelative(source.lastIndexedAt)}`;
  }
  return 'Ready for its first sync.';
}

function SourceCard({
  source,
  rules,
  busy,
  expanded,
  onToggleExpanded,
  onRulesChange,
  onSync,
  onClear,
}: {
  source: KnowledgeSourceSummary;
  rules: KnowledgeSourceRules;
  busy: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onRulesChange: (next: KnowledgeSourceRules) => void;
  onSync: () => void;
  onClear: () => void;
}): React.JSX.Element {
  const status = SOURCE_STATUS[source.status];
  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[4px] border border-line bg-raised text-ink-3">
          <Icon name={source.id === 'obsidian' ? 'folder' : 'network'} size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-[12px] font-medium text-ink">{source.name}</p>
            <Chip tone={status.tone}>{status.label}</Chip>
          </div>
          <p className="mt-1 text-[11px] leading-[1.55] text-ink-3">{sourceDetail(source)}</p>
          {source.lastError ? (
            <p className="mt-1 text-[10.5px] leading-[1.5] text-danger">{source.lastError}</p>
          ) : null}
          {source.truncated ? (
            <p className="mt-1 text-[10.5px] text-warn">
              The connector capped the last scan; older documents may be missing.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Switch
              label={`Index ${source.name}`}
              checked={rules.enabled}
              disabled={!source.connected || !source.supportsIndexing}
              onChange={(next) => onRulesChange({ ...rules, enabled: next })}
            />
            <span className="font-mono text-[8px] uppercase tracking-[0.06em] text-ink-4">
              {rules.enabled ? 'index this source' : 'excluded'}
            </span>
            <button
              type="button"
              onClick={onToggleExpanded}
              className="ml-auto font-mono text-[8px] uppercase tracking-[0.06em] text-ink-3 hover:text-ink"
            >
              {expanded ? 'Hide rules' : 'Rules'}
            </button>
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-3 border-t border-line bg-base/35 px-4 py-3.5">
          <TextAreaField
            label="Exclude paths, pages or IDs"
            value={lines(rules.excludePaths)}
            onChange={(value) => onRulesChange({ ...rules, excludePaths: parseLines(value) })}
            rows={3}
            maxLength={6_000}
            placeholder={'Archive\nProjects/Private\nNotion page title or id'}
            hint="One per line. Case-insensitive; * and ? wildcards are supported."
          />
          <TextAreaField
            label="Exclude categories"
            value={lines(rules.excludeCategories)}
            onChange={(value) =>
              onRulesChange({ ...rules, excludeCategories: parseLines(value) })
            }
            rows={2}
            maxLength={6_000}
            placeholder={'Journal\nPrivate'}
            hint="Folder, parent, or object type shown in the source."
          />
          <TextAreaField
            label="Exclude tags"
            value={lines(rules.excludeTags)}
            onChange={(value) => onRulesChange({ ...rules, excludeTags: parseLines(value) })}
            rows={2}
            maxLength={5_000}
            placeholder={'private\nsecret'}
            hint="Exact tag names without #."
          />
          {source.documents > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <p className="text-[10.5px] text-ink-3">
                Removing exclusions takes effect on the next sync.
              </p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" icon="refresh" disabled={busy} onClick={onSync}>
                  Sync now
                </Button>
                <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={onClear}>
                  Clear
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgePage(): React.JSX.Element {
  const { push } = useToast();
  const knowledge = useKnowledge();
  const snapshot = knowledge.snapshot;

  const [enabled, setEnabled] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, KnowledgeSourceRules>>({});
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | 'all' | null>(null);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<KnowledgeSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<'all' | string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot || dirty) return;
    setEnabled(snapshot.settings.enabled);
    setDrafts(
      Object.fromEntries(
        snapshot.sources.map((source) => [
          source.id,
          { ...source.rules, excludePaths: [...source.rules.excludePaths], excludeCategories: [...source.rules.excludeCategories], excludeTags: [...source.rules.excludeTags] },
        ]),
      ),
    );
  }, [snapshot, dirty]);

  const setRules = (source: string, next: KnowledgeSourceRules): void => {
    setDrafts((current) => ({ ...current, [source]: next }));
    setDirty(true);
  };

  const save = async (): Promise<void> => {
    if (!snapshot || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      await knowledge.updateSettings({
        enabled,
        sources: snapshot.sources.map((source) => ({
          source: source.id,
          ...(drafts[source.id] ?? source.rules),
        })),
      });
      setDirty(false);
      push('Knowledge settings saved', {
        detail: enabled
          ? 'Run Sync to update the local index. Nothing is fetched automatically.'
          : 'Indexing and search are off. Existing content was left in place unless a source was disabled.',
        tone: 'success',
      });
    } catch (cause) {
      setActionError(toApiError(cause).message);
    } finally {
      setSaving(false);
    }
  };

  const sync = async (sources?: string[]): Promise<void> => {
    setSyncing(sources?.length === 1 ? sources[0]! : 'all');
    setActionError(null);
    try {
      const result = await knowledge.sync(sources);
      push('Knowledge sync finished', {
        detail: `${pluralize(result.documentsIndexed, 'document')} indexed, ${pluralize(result.documentsSkipped, 'unchanged document')}, ${pluralize(result.documentsFailed, 'failure')}.`,
        tone: result.failedSources > 0 ? 'error' : 'success',
      });
      if (dirty) setDirty(false);
    } catch (cause) {
      setActionError(toApiError(cause).message);
    } finally {
      setSyncing(null);
    }
  };

  const runSearch = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearchError(null);
    setActionError(null);
    try {
      const tags = tagFilter
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 10);
      setSearchResult(
        await knowledge.search({
          query: query.trim(),
          ...(sourceFilter !== 'all' ? { sources: [sourceFilter] } : {}),
          ...(tags.length > 0 ? { tags } : {}),
          ...(from ? { updatedFrom: from } : {}),
          ...(to ? { updatedTo: to } : {}),
          limit: 20,
        }),
      );
    } catch (cause) {
      setSearchError(toApiError(cause).message);
    } finally {
      setSearching(false);
    }
  };

  const clear = async (): Promise<void> => {
    if (!clearTarget) return;
    setActionError(null);
    try {
      const result = await knowledge.clear(clearTarget === 'all' ? undefined : clearTarget);
      push('Indexed content cleared', {
        detail: `${pluralize(result.documentsRemoved, 'document')} removed from this device. Original connector content is unchanged.`,
        tone: 'success',
      });
      setClearTarget(null);
      setSearchResult(null);
    } catch (cause) {
      setActionError(toApiError(cause).message);
    }
  };

  const enabledSources = snapshot?.sources.filter((source) => source.indexingEnabled) ?? [];
  const statusChip = !snapshot ? (
    <Chip>Loading</Chip>
  ) : snapshot.settings.enabled ? (
    <Chip tone="ok">Local index on</Chip>
  ) : (
    <Chip tone="warn">Index off</Chip>
  );

  return (
    <ModulePage
      kicker={
        <>
          Local knowledge <span className="slash">/</span>{' '}
          <span className="accent">Unified index</span>
        </>
      }
      title="Knowledge"
      description="Search approved content from every connected second brain in one place. Indexing is opt-in, incremental and stored only in local SQLite."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {statusChip}
          <Button
            size="sm"
            variant="primary"
            icon="refresh"
            disabled={Boolean(syncing) || enabledSources.length === 0 || !snapshot?.settings.enabled}
            onClick={() => void sync(enabledSources.map((source) => source.id))}
          >
            {syncing === 'all' ? 'Syncing…' : 'Sync index'}
          </Button>
          <IconButton icon="refresh" label="Reload knowledge status" size="sm" onClick={knowledge.refresh} />
        </div>
      }
    >
      {knowledge.loading && !snapshot ? (
        <Panel>
          <div className="flex min-h-[320px] items-center justify-center px-6 text-[11.5px] text-ink-3">
            Reading the local index…
          </div>
        </Panel>
      ) : knowledge.error && !snapshot ? (
        <Panel>
          <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
            <Icon name="warning" size={20} className="mb-3 text-danger" />
            <p className="font-serif text-[23px] text-ink">Knowledge unavailable</p>
            <p className="mt-1.5 max-w-[44ch] text-[11.5px] leading-[1.65] text-ink-3">
              {knowledge.error.message}
            </p>
            <Button size="sm" variant="secondary" icon="refresh" className="mt-4" onClick={knowledge.refresh}>
              Retry
            </Button>
          </div>
        </Panel>
      ) : snapshot ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Indexed documents', snapshot.stats.documents],
              ['Text chunks', snapshot.stats.chunks],
              ['Active sources', snapshot.stats.sources],
              ['Distinct tags', snapshot.stats.tags],
            ].map(([label, value]) => (
              <Panel key={String(label)} className="px-4 py-3">
                <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-ink-4">{label}</p>
                <p className="mt-1.5 font-serif text-[26px] leading-none tabular text-ink">{value}</p>
              </Panel>
            ))}
          </div>

          {!snapshot.connectorsEnabled ? (
            <Note tone="warn" icon={<Icon name="warning" size={13} />}>
              Connections are disabled by the local node, so no source can be indexed or refreshed.
            </Note>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(330px,0.8fr)]">
            <div className="space-y-4">
              <Panel>
                <PanelHeader
                  title="Search every approved source"
                  description="Keywords and “quoted phrases” use SQLite FTS5 ranking. Excerpts below are returned from the local index; a hit is never invented."
                  action={<Chip tone="accent">Keyword</Chip>}
                />
                <form onSubmit={(event) => void runSearch(event)} className="space-y-3 px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <TextField
                      hideLabel
                      label="Search the knowledge index"
                      value={query}
                      onChange={setQuery}
                      placeholder='Try "launch decision" or local-first roadmap'
                      maxLength={300}
                      prefix={<Icon name="search" size={12} />}
                      className="min-w-[220px] flex-1"
                    />
                    <Button size="sm" variant="primary" type="submit" disabled={!query.trim() || searching || !snapshot.settings.enabled}>
                      {searching ? 'Searching…' : 'Search'}
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <SelectField
                      hideLabel
                      label="Source filter"
                      value={sourceFilter}
                      onChange={setSourceFilter}
                      options={[
                        { value: 'all', label: 'All sources' },
                        ...snapshot.sources
                          .filter((source) => source.documents > 0)
                          .map((source) => ({ value: source.id, label: source.name })),
                      ]}
                    />
                    <TextField
                      hideLabel
                      label="Tag filter"
                      value={tagFilter}
                      onChange={setTagFilter}
                      placeholder="tags, comma-separated"
                      maxLength={200}
                    />
                    <input
                      aria-label="Updated from"
                      type="date"
                      value={from}
                      onChange={(event) => setFrom(event.target.value)}
                      className="h-[34px] w-full rounded-[8px] border border-line bg-raised px-2.5 text-[11.5px] text-ink t-ui"
                    />
                    <input
                      aria-label="Updated to"
                      type="date"
                      value={to}
                      onChange={(event) => setTo(event.target.value)}
                      className="h-[34px] w-full rounded-[8px] border border-line bg-raised px-2.5 text-[11.5px] text-ink t-ui"
                    />
                  </div>
                  {searchError ? <p className="text-[11px] text-danger">{searchError}</p> : null}
                </form>

                {searchResult ? (
                  <div className="border-t border-line">
                    <div className="flex items-center justify-between gap-3 px-4 py-2 font-mono text-[8px] uppercase tracking-[0.07em] text-ink-4">
                      <span>
                        {searchResult.total} matching {searchResult.total === 1 ? 'document' : 'documents'}
                      </span>
                      <span>{searchResult.hits.length} excerpts</span>
                    </div>
                    {searchResult.hits.length === 0 ? (
                      <div className="px-4 py-10 text-center">
                        <p className="font-serif text-[21px] text-ink">No indexed document matched</p>
                        <p className="mx-auto mt-1.5 max-w-[46ch] text-[11.5px] leading-[1.65] text-ink-3">
                          Nothing is cited because no result was found. Try another phrase, clear filters, or sync more sources.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-line">
                        {searchResult.hits.map((hit) => (
                          <article key={hit.id} className="px-4 py-3.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Chip tone="accent">{hit.sourceLabel}</Chip>
                              <span className="text-[10px] text-ink-4">{hit.category || 'Document'}</span>
                              <span className="ml-auto font-mono text-[8.5px] uppercase tracking-[0.04em] text-ink-4">
                                {formatRelative(hit.updatedAt)}
                              </span>
                            </div>
                            <h3 className="mt-1.5 text-[13px] font-medium leading-snug text-ink">{hit.title}</h3>
                            <p className="mt-1 text-[12px] leading-[1.65] text-ink-2">“{hit.excerpt}”</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <code className="max-w-full truncate rounded-[3px] bg-raised px-1.5 py-0.5 font-mono text-[9.5px] text-ink-3">
                                {hit.path}
                              </code>
                              {hit.tags.slice(0, 5).map((tag) => (
                                <span key={tag} className="font-mono text-[8.5px] text-ink-4">#{tag}</span>
                              ))}
                              {hit.url ? (
                                <a href={hit.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[10px] text-accent">
                                  Open <Icon name="external" size={10} />
                                </a>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border-t border-line px-4 py-10 text-center">
                    <Icon name="search" size={19} className="mx-auto mb-2 text-ink-4" />
                    <p className="text-[12px] text-ink-2">Search the local index</p>
                    <p className="mx-auto mt-1 max-w-[44ch] text-[11px] leading-[1.6] text-ink-3">
                      No provider is called by this search. When the agent uses it, the returned excerpts become part of the model request.
                    </p>
                  </div>
                )}
              </Panel>

              <Note tone="accent" icon={<Icon name="shield" size={13} />}>
                <strong className="text-ink-2">Local by default.</strong> The index is stored in CAERA’s SQLite database on this computer. Connector content is read only when you press Sync. A direct search stays local; when the selected model uses the knowledge tool, the selected source excerpts are sent to that configured provider. Clear the index at any time without changing the original documents.
              </Note>
            </div>

            <div className="space-y-4">
              <Panel>
                <PanelHeader
                  title="Index control"
                  description="Nothing is indexed automatically. Enable the global switch, choose sources, save, then sync."
                  action={<Switch label="Enable local knowledge indexing" checked={enabled} onChange={(next) => { setEnabled(next); setDirty(true); }} />}
                />
                <div className="space-y-3 border-b border-line px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-ink-3">Global indexing</span>
                    <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-ink-4">
                      {enabled ? 'on' : 'off'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-ink-3">Automatic sync</span>
                    <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-ink-4">
                      off / manual
                    </span>
                  </div>
                  <p className="text-[10.5px] leading-[1.55] text-ink-4">
                    Search stays disabled while global indexing is off. Disabling a source removes its indexed documents immediately.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
                      {saving ? 'Saving…' : 'Save settings'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!snapshot.stats.documents} onClick={() => setClearTarget('all')}>
                      Clear index
                    </Button>
                  </div>
                  {actionError ? <p className="text-[11px] leading-[1.5] text-danger">{actionError}</p> : null}
                </div>

                <div>
                  {snapshot.sources.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[11.5px] text-ink-3">
                      No connector adapters are registered. Content cannot be indexed yet.
                    </div>
                  ) : (
                    snapshot.sources.map((source) => (
                      <SourceCard
                        key={source.id}
                        source={source}
                        rules={drafts[source.id] ?? source.rules}
                        busy={Boolean(syncing) || saving}
                        expanded={expanded === source.id}
                        onToggleExpanded={() => setExpanded(expanded === source.id ? null : source.id)}
                        onRulesChange={(next) => setRules(source.id, next)}
                        onSync={() => void sync([source.id])}
                        onClear={() => setClearTarget(source.id)}
                      />
                    ))
                  )}
                </div>
              </Panel>

              <Panel>
                <PanelHeader title="Index architecture" action={<Chip>Local</Chip>} />
                <div className="space-y-2 px-4 py-3 text-[11px] leading-[1.6] text-ink-3">
                  <p>SQLite FTS5 · Unicode tokenizer · BM25 ranking</p>
                  <p>Incremental by source timestamp + fingerprint; unchanged documents are not re-read.</p>
                  <p>Disconnected sources are skipped. Read revocation or disconnect purges their local rows.</p>
                  <p>Chunk ids are reserved for a future local embedding pass. Semantic retrieval is not enabled.</p>
                </div>
              </Panel>
            </div>
          </div>
        </div>
      ) : null}

      <Modal open={clearTarget !== null} onClose={() => setClearTarget(null)} label="Clear knowledge index" width={460}>
        <div className="px-4 py-4">
          <h2 className="text-[13.5px] font-medium text-ink">
            {clearTarget === 'all' ? 'Clear the entire local index?' : 'Clear this source from the index?'}
          </h2>
          <p className="mt-1.5 text-[11.5px] leading-[1.65] text-ink-3">
            The indexed text and metadata will be removed from SQLite. Original notes, pages and objects are not changed. Sync can rebuild the index later.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button size="sm" variant="ghost" onClick={() => setClearTarget(null)}>Cancel</Button>
          <Button size="sm" variant="danger" icon="trash" onClick={() => void clear()}>
            Clear indexed content
          </Button>
        </div>
      </Modal>
    </ModulePage>
  );
}
