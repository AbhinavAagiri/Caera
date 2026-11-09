import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  ConnectorNote,
  ConnectorNoteSummary,
  ConnectorOperationResult,
} from '@shared';
import { MarkdownMessage } from '@/components/conversation/MarkdownMessage';
import { Icon, type IconName } from '@/components/icons/Icon';
import { ModulePage } from '@/components/layout/ModulePage';
import { Button, IconButton } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Controls';
import { Chip } from '@/components/ui/Indicators';
import { Modal } from '@/components/ui/Overlay';
import { Note, Panel, PanelHeader, SectionHeading } from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { useConnectors } from '@/hooks/useConnectors';
import { formatRelative } from '@/lib/format';
import { api, toApiError } from '@/services/api';

const PAGE_META = {
  notion: {
    name: 'Notion',
    title: 'Notion pages',
    icon: 'globe' as IconName,
    noun: 'page',
    description:
      'Search pages shared with the Notion integration, read their content as Markdown, browse data-source entries, and write with independent permissions. The integration token stays on this node.',
    searchHint: 'Notion searches page titles and recently edited pages, not body text.',
  },
  logseq: {
    name: 'Logseq',
    title: 'Logseq graph',
    icon: 'network' as IconName,
    noun: 'page',
    description:
      'Search the graph currently open in Logseq, read block trees and linked references, and append or update content. Method support varies by Logseq version and graph type.',
    searchHint: 'Searches page titles in the current graph. Empty search lists pages.',
  },
  anytype: {
    name: 'Anytype',
    title: 'Anytype objects',
    icon: 'node' as IconName,
    noun: 'object',
    description:
      'Search one Anytype space, read object Markdown and properties, and create or update supported objects through the local API. The API key never reaches the browser.',
    searchHint: 'Searches object names and snippets in the configured space.',
  },
} as const;

type KnowledgeId = keyof typeof PAGE_META;

const PARENT_TYPE_OPTIONS = [
  { value: 'page', label: 'Page' },
  { value: 'data-source', label: 'Data source' },
];

function isKnowledgeId(value: string | undefined): value is KnowledgeId {
  return value === 'notion' || value === 'logseq' || value === 'anytype';
}

function errorMessage(cause: unknown): string {
  const error = toApiError(cause);
  return error.hint ? `${error.message} ${error.hint}` : error.message;
}

async function runTool(
  connectorId: KnowledgeId,
  operation: string,
  args: Record<string, unknown>,
  confirmed = false,
): Promise<ConnectorOperationResult> {
  const response = await api.executeConnectorTool(
    `${connectorId}.${operation}`,
    args,
    confirmed,
  );
  return response.result;
}

function relativeDate(iso: string): string {
  const year = new Date(iso).getUTCFullYear();
  return Number.isFinite(year) && year > 1980 ? formatRelative(iso) : 'unknown';
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} kB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function firstBlockId(note: ConnectorNote): string {
  const value = note.frontmatter.values.blockIds;
  return Array.isArray(value)
    ? value.find((entry): entry is string => typeof entry === 'string') ?? ''
    : '';
}

function StatusPanel({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}): React.JSX.Element {
  return (
    <Panel>
      <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center">
        <div className="relative mb-4 grid size-[68px] place-items-center rounded-full border border-line">
          <span
            className="absolute inset-[7px] rounded-full border border-dashed border-line"
            aria-hidden="true"
          />
          <Icon name="network" size={22} className="text-ink-3" />
        </div>
        <p className="font-serif text-[23px] leading-tight text-ink">{title}</p>
        <p className="mx-auto mt-1.5 max-w-[48ch] text-[11.5px] leading-[1.7] text-ink-3">
          {description}
        </p>
        <Button size="sm" variant="primary" icon="network" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </Panel>
  );
}

export function KnowledgeConnectorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const params = useParams<{ connectorId: string }>();
  const rawId = params.connectorId;

  if (!isKnowledgeId(rawId)) {
    return (
      <ModulePage
        kicker={
          <>
            Integrations <span className="slash">/</span> Connections
          </>
        }
        title="Unknown connector"
        description="That connector does not have a knowledge workspace."
        actions={
          <Button size="sm" variant="primary" onClick={() => navigate('/connections')}>
            Open Connections
          </Button>
        }
      >
        <StatusPanel
          title="No workspace for that connector"
          description="Obsidian uses its own vault page. Notion, Logseq and Anytype use the knowledge workspace."
          actionLabel="Back to Connections"
          onAction={() => navigate('/connections')}
        />
      </ModulePage>
    );
  }

  return <KnowledgeWorkspace connectorId={rawId} />;
}

function KnowledgeWorkspace({
  connectorId,
}: {
  connectorId: KnowledgeId;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { push } = useToast();
  const connectors = useConnectors();
  const meta = PAGE_META[connectorId];

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConnectorNoteSummary[]>([]);
  const [resultTotal, setResultTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [listLoaded, setListLoaded] = useState(false);

  const [selected, setSelected] = useState<ConnectorNote | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState('');
  const [createParentType, setCreateParentType] = useState('page');
  const [createTypeKey, setCreateTypeKey] = useState('page');
  const [createTitle, setCreateTitle] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createProperties, setCreateProperties] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [appendOpen, setAppendOpen] = useState(false);
  const [appendContent, setAppendContent] = useState('');
  const [appending, setAppending] = useState(false);
  const [appendError, setAppendError] = useState<string | null>(null);

  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateName, setUpdateName] = useState('');
  const [updateBlockId, setUpdateBlockId] = useState('');
  const [updateContent, setUpdateContent] = useState('');
  const [updateProperties, setUpdateProperties] = useState('');
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const [dataSourceOpen, setDataSourceOpen] = useState(false);
  const [dataSourceId, setDataSourceId] = useState('');
  const [dataSourceError, setDataSourceError] = useState<string | null>(null);
  const [dataSourceBusy, setDataSourceBusy] = useState(false);

  const didInitialSearch = useRef(false);

  const snapshot = connectors.snapshot;
  const integration = snapshot?.connectors.find((entry) => entry.id === connectorId) ?? null;
  const connected = integration?.connection.status === 'connected';
  const grants = integration?.grants ?? {
    read: false,
    create: false,
    edit: false,
    delete: false,
  };
  const ready = Boolean(connected && grants.read);

  const runSearch = useCallback(
    async (searchQuery: string): Promise<void> => {
      setSearching(true);
      setSearchError(null);
      try {
        const result = await runTool(connectorId, 'search', {
          query: searchQuery.trim(),
          limit: 30,
        });
        if (result.type !== 'search') {
          throw new Error('The connector returned an unexpected search result.');
        }
        setResults(result.notes);
        setResultTotal(result.total);
        setListLoaded(true);
      } catch (cause) {
        setSearchError(errorMessage(cause));
      } finally {
        setSearching(false);
      }
    },
    [connectorId],
  );

  useEffect(() => {
    didInitialSearch.current = false;
    setQuery('');
    setResults([]);
    setListLoaded(false);
    setSelected(null);
    setSearchError(null);
    setActionError(null);
  }, [connectorId]);

  useEffect(() => {
    if (!ready) {
      didInitialSearch.current = false;
      setResults([]);
      setListLoaded(false);
      setSelected(null);
      setSearchError(null);
      return;
    }
    if (didInitialSearch.current) return;
    didInitialSearch.current = true;
    void runSearch('');
  }, [ready, runSearch]);

  const loadNote = useCallback(
    async (path: string): Promise<void> => {
      setLoadingNote(true);
      setActionError(null);
      try {
        const result = await runTool(connectorId, 'read', { path });
        if (result.type !== 'read') {
          throw new Error('The connector returned an unexpected read result.');
        }
        setSelected(result.note);
      } catch (cause) {
        push(`Could not read ${meta.noun}`, {
          detail: errorMessage(cause),
          tone: 'error',
        });
      } finally {
        setLoadingNote(false);
      }
    },
    [connectorId, meta.noun, push],
  );

  const submitSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void runSearch(query);
  };

  const clearSearch = (): void => {
    setQuery('');
    void runSearch('');
  };

  const refreshPage = (): void => {
    connectors.refresh();
    if (ready) void runSearch(query);
  };

  const openSelected = async (): Promise<void> => {
    if (!selected) return;
    try {
      const result = await runTool(connectorId, 'open', { path: selected.path });
      if (result.type !== 'open') {
        throw new Error('The connector did not return an application link.');
      }
      const anchor = document.createElement('a');
      anchor.href = result.url;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (cause) {
      push('Could not open in Notion', {
        detail: errorMessage(cause),
        tone: 'error',
      });
    }
  };

  const loadReferences = async (): Promise<void> => {
    if (!selected) return;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await runTool(connectorId, 'references', {
        path: selected.path,
        limit: 30,
      });
      if (result.type !== 'search') {
        throw new Error('The connector returned an unexpected reference result.');
      }
      setResults(result.notes);
      setResultTotal(result.total);
      setListLoaded(true);
      push('References loaded', {
        detail: `${result.notes.length} referencing blocks shown.`,
        tone: 'success',
      });
    } catch (cause) {
      setSearchError(errorMessage(cause));
    } finally {
      setSearching(false);
    }
  };

  const openCreate = (): void => {
    if (!grants.create) {
      push('Create permission is off', {
        detail: 'Grant create access in Connections before adding content.',
        tone: 'error',
      });
      return;
    }
    setCreateParent('');
    setCreateParentType('page');
    setCreateTypeKey(integration?.connection.configuration.typeKey ?? 'page');
    setCreateTitle('');
    setCreateContent('');
    setCreateProperties('');
    setCreateError(null);
    setCreateOpen(true);
  };

  const submitCreate = async (): Promise<void> => {
    if (!createTitle.trim() || creating) {
      setCreateError(`A ${meta.noun} title is required.`);
      return;
    }
    if (connectorId === 'notion' && !createParent.trim()) {
      setCreateError('A parent page or data source ID is required.');
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const args: Record<string, unknown> = {
        title: createTitle.trim(),
        content: createContent,
      };
      if (connectorId === 'notion') {
        args.parentId = createParent.trim();
        args.parentType = createParentType;
      }
      if (connectorId === 'logseq') {
        // Only title and content are supported by the Logseq create operation.
      }
      if (connectorId === 'anytype') {
        args.typeKey = createTypeKey.trim() || 'page';
      }
      if (createProperties.trim()) {
        args.properties = createProperties.trim();
      }

      const result = await runTool(connectorId, 'create', args);
      if (result.type !== 'write') {
        throw new Error('The connector returned an unexpected write result.');
      }
      setCreateOpen(false);
      await runSearch(query);
      await loadNote(result.note.path);
      push(`${meta.name} ${meta.noun} created`, {
        detail: result.note.title,
        tone: 'success',
      });
    } catch (cause) {
      setCreateError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  };

  const openAppend = (): void => {
    if (!selected || !grants.edit) {
      push('Edit permission is off', {
        detail: 'Grant edit access in Connections before appending content.',
        tone: 'error',
      });
      return;
    }
    setAppendContent('');
    setAppendError(null);
    setAppendOpen(true);
  };

  const submitAppend = async (): Promise<void> => {
    if (!selected || !appendContent.trim() || appending) return;
    setAppending(true);
    setAppendError(null);
    try {
      const result = await runTool(connectorId, 'append', {
        path: selected.path,
        content: appendContent,
      });
      if (result.type !== 'write') {
        throw new Error('The connector returned an unexpected write result.');
      }
      setAppendOpen(false);
      await loadNote(selected.path);
      push('Content appended', { detail: selected.path, tone: 'success' });
    } catch (cause) {
      setAppendError(errorMessage(cause));
    } finally {
      setAppending(false);
    }
  };

  const openUpdate = (): void => {
    if (!selected || !grants.edit) {
      push('Edit permission is off', {
        detail: 'Grant edit access in Connections before updating content.',
        tone: 'error',
      });
      return;
    }
    setUpdateName(selected.title);
    setUpdateBlockId(firstBlockId(selected));
    setUpdateContent(connectorId === 'anytype' ? selected.content : '');
    setUpdateProperties('');
    setUpdateError(null);
    setUpdateOpen(true);
  };

  const submitUpdate = async (): Promise<void> => {
    if (!selected || updating) return;
    setUpdateError(null);

    if (connectorId === 'logseq' && (!updateBlockId.trim() || !updateContent.trim())) {
      setUpdateError('A block ID and replacement content are required.');
      return;
    }
    if (
      connectorId === 'notion' &&
      !updateName.trim() &&
      !updateProperties.trim()
    ) {
      setUpdateError('Provide a title or at least one property.');
      return;
    }

    setUpdating(true);
    try {
      const args: Record<string, unknown> = { path: selected.path };
      if (connectorId === 'notion') {
        if (updateName.trim()) args.title = updateName.trim();
        if (updateProperties.trim()) args.properties = updateProperties.trim();
      }
      if (connectorId === 'logseq') {
        args.blockId = updateBlockId.trim();
        args.content = updateContent;
      }
      if (connectorId === 'anytype') {
        args.name = updateName.trim();
        args.content = updateContent;
        if (updateProperties.trim()) args.properties = updateProperties.trim();
      }

      const updateOperation = connectorId === 'logseq' ? 'update-block' : 'update';
      const result = await runTool(connectorId, updateOperation, args, true);
      if (result.type !== 'write') {
        throw new Error('The connector returned an unexpected write result.');
      }
      setUpdateOpen(false);
      await loadNote(result.note.path);
      await runSearch(query);
      push('Content updated', { detail: result.note.title, tone: 'success' });
    } catch (cause) {
      setUpdateError(errorMessage(cause));
    } finally {
      setUpdating(false);
    }
  };

  const submitDataSource = async (): Promise<void> => {
    if (!dataSourceId.trim() || dataSourceBusy) {
      setDataSourceError('A data source ID is required.');
      return;
    }
    setDataSourceBusy(true);
    setDataSourceError(null);
    try {
      const result = await runTool(connectorId, 'query-data-source', {
        dataSourceId: dataSourceId.trim(),
        limit: 30,
      });
      if (result.type !== 'search') {
        throw new Error('Notion returned an unexpected data-source result.');
      }
      setResults(result.notes);
      setResultTotal(result.total);
      setListLoaded(true);
      setDataSourceOpen(false);
      push('Data source loaded', {
        detail: `${result.notes.length} entries shown.`,
        tone: 'success',
      });
    } catch (cause) {
      setDataSourceError(errorMessage(cause));
    } finally {
      setDataSourceBusy(false);
    }
  };

  const statusChip = connected ? (
    <Chip tone="ok">Connected</Chip>
  ) : integration?.connection.status === 'error' ? (
    <Chip tone="danger">Connection error</Chip>
  ) : (
    <Chip tone="neutral">Not connected</Chip>
  );

  return (
    <ModulePage
      kicker={
        <>
          Integrations <span className="slash">/</span>{' '}
          <span className="accent">{meta.name}</span>
        </>
      }
      title={meta.title}
      description={meta.description}
      actions={
        <div className="flex items-center gap-2">
          {statusChip}
          <IconButton icon="refresh" label={`Refresh ${meta.name}`} size="sm" onClick={refreshPage} />
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            disabled={!connected || !grants.create}
            onClick={openCreate}
          >
            New {meta.noun}
          </Button>
        </div>
      }
    >
      {connectors.loading && !snapshot ? (
        <Panel>
          <div className="space-y-3 px-4 py-5" aria-hidden="true">
            <div className="h-3 w-[28%] animate-pulse rounded bg-raised" />
            <div className="h-3 w-[64%] animate-pulse rounded bg-raised" />
            <div className="mt-4 h-[220px] animate-pulse rounded-[5px] border border-line bg-raised/50" />
          </div>
        </Panel>
      ) : connectors.error && !snapshot ? (
        <Panel>
          <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-12 text-center">
            <span className="mb-3 text-danger">
              <Icon name="warning" size={20} />
            </span>
            <p className="font-serif text-[22px] leading-tight text-ink">
              {meta.name} unavailable
            </p>
            <p className="mt-1.5 max-w-[46ch] text-[11.5px] leading-[1.6] text-ink-3">
              {connectors.error.message}
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              className="mt-4"
              onClick={refreshPage}
            >
              Retry
            </Button>
          </div>
        </Panel>
      ) : !connected ? (
        <StatusPanel
          title={
            integration?.connection.status === 'error'
              ? `${meta.name} needs attention`
              : `${meta.name} is not connected`
          }
          description={
            integration?.connection.lastError ??
            `Connect ${meta.name} in Connections to search, read and write supported content. Permissions start read-only.`
          }
          actionLabel="Open Connections"
          onAction={() => navigate('/connections')}
        />
      ) : !grants.read ? (
        <StatusPanel
          title="Read permission is off"
          description={`${meta.name} is connected, but this connector cannot search or read content. Grant read access deliberately in Connections.`}
          actionLabel="Manage permissions"
          onAction={() => navigate('/connections')}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-4">
            <Panel>
              <PanelHeader title="Search" description={meta.searchHint} />
              <form onSubmit={submitSearch} className="space-y-3 px-4 py-3.5">
                <TextField
                  label={`Search ${meta.name}`}
                  value={query}
                  onChange={setQuery}
                  placeholder={`Search ${meta.noun}s`}
                  maxLength={200}
                  disabled={searching}
                />
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    variant="primary"
                    icon="search"
                    disabled={searching}
                  >
                    {searching ? 'Searching…' : 'Search'}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={searching} onClick={clearSearch}>
                    Clear
                  </Button>
                </div>
                {connectorId === 'notion' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="storage"
                    className="w-full"
                    onClick={() => {
                      setDataSourceId('');
                      setDataSourceError(null);
                      setDataSourceOpen(true);
                    }}
                  >
                    Browse a data source
                  </Button>
                ) : null}
              </form>
            </Panel>

            <section>
              <SectionHeading
                title={connectorId === 'logseq' && results[0]?.folder === 'Reference' ? 'References' : 'Results'}
                aside={
                  <Chip tone="neutral">
                    {listLoaded ? `${results.length}/${resultTotal}` : '—'}
                  </Chip>
                }
              />
              <Panel>
                {searchError ? (
                  <div className="px-3 py-3">
                    <Note tone="danger" icon={<Icon name="warning" size={13} />}>
                      {searchError}
                    </Note>
                  </div>
                ) : searching && !listLoaded ? (
                  <div className="space-y-2 px-4 py-4" aria-hidden="true">
                    <div className="h-3 w-[56%] animate-pulse rounded bg-raised" />
                    <div className="h-3 w-[82%] animate-pulse rounded bg-raised" />
                    <div className="h-3 w-[44%] animate-pulse rounded bg-raised" />
                  </div>
                ) : results.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Icon name="search" size={17} className="mx-auto text-ink-3" />
                    <p className="mt-2 text-[12px] text-ink-2">No {meta.noun}s found</p>
                    <p className="mt-1 text-[11px] leading-[1.55] text-ink-3">
                      Try a broader search or check that the connection can access the item.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-[560px] divide-y divide-line overflow-y-auto">
                    {results.map((note) => {
                      const active = selected?.path === note.path;
                      return (
                        <button
                          key={`${note.path}-${note.title}`}
                          type="button"
                          onClick={() => void loadNote(note.path)}
                          className={`block w-full px-3.5 py-3 text-left t-ui ${
                            active ? 'bg-raised' : 'hover:bg-raised/60'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="min-w-0 truncate text-[12px] font-medium text-ink">
                              {note.title}
                            </p>
                            <span className="shrink-0 font-mono text-[8px] text-ink-4">
                              {relativeDate(note.updatedAt)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[9px] text-ink-4">
                            {note.folder} · {note.path}
                          </p>
                          <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-[1.55] text-ink-3">
                            {note.excerpt || 'Empty result'}
                          </p>
                          {note.tags.length > 0 ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {note.tags.slice(0, 4).map((tag) => (
                                <Chip key={tag} tone="accent">
                                  {tag}
                                </Chip>
                              ))}
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </section>
          </aside>

          <section className="min-w-0">
            <SectionHeading
              title={selected ? selected.title : `Read a ${meta.noun}`}
              aside={selected ? <Chip tone="neutral">{selected.folder}</Chip> : undefined}
            />
            <Panel>
              {loadingNote ? (
                <div className="space-y-3 px-4 py-5" aria-hidden="true">
                  <div className="h-4 w-[42%] animate-pulse rounded bg-raised" />
                  <div className="h-3 w-[86%] animate-pulse rounded bg-raised" />
                  <div className="h-3 w-[72%] animate-pulse rounded bg-raised" />
                  <div className="h-3 w-[60%] animate-pulse rounded bg-raised" />
                </div>
              ) : !selected ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center">
                  <Icon name={meta.icon} size={22} className="text-ink-3" />
                  <p className="mt-3 font-serif text-[21px] leading-tight text-ink">
                    Select a {meta.noun}
                  </p>
                  <p className="mt-1.5 max-w-[42ch] text-[11.5px] leading-[1.6] text-ink-3">
                    Search results show a bounded excerpt. Reading a result fetches its content and
                    properties from {meta.name}.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[9px] uppercase tracking-[0.05em] text-ink-4">
                        {selected.path}
                      </p>
                      <p className="mt-1 text-[10.5px] text-ink-3">
                        Updated {relativeDate(selected.updatedAt)} · {formatBytes(selected.sizeBytes)}
                        {selected.truncated ? ' · truncated' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {connectorId === 'notion' ? (
                        <Button size="sm" variant="ghost" icon="globe" onClick={() => void openSelected()}>
                          Open in Notion
                        </Button>
                      ) : null}
                      {connectorId === 'logseq' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="network"
                          onClick={() => void loadReferences()}
                        >
                          References
                        </Button>
                      ) : null}
                      {connectorId !== 'anytype' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon="plus"
                          disabled={!grants.edit}
                          onClick={openAppend}
                        >
                          Append
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="edit"
                        disabled={!grants.edit}
                        onClick={openUpdate}
                      >
                        Update
                      </Button>
                    </div>
                  </div>

                  {actionError ? (
                    <div className="border-b border-line px-3 py-2.5">
                      <Note tone="danger" icon={<Icon name="warning" size={13} />}>
                        {actionError}
                      </Note>
                    </div>
                  ) : null}

                  <div className="max-h-[560px] overflow-y-auto px-4 py-4">
                    {selected.content.trim() ? (
                      <MarkdownMessage content={selected.content} />
                    ) : (
                      <p className="text-[12px] text-ink-3">This {meta.noun} has no body content.</p>
                    )}
                  </div>

                  {selected.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-3">
                      {selected.tags.map((tag) => (
                        <Chip key={tag} tone="accent">
                          {tag}
                        </Chip>
                      ))}
                    </div>
                  ) : null}

                  {Object.keys(selected.frontmatter.values).length > 0 ? (
                    <div className="border-t border-line px-4 py-3">
                      <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-ink-4">
                        Properties
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {Object.entries(selected.frontmatter.values).map(([key, value]) => (
                          <div key={key} className="min-w-0 rounded-[4px] border border-line bg-base/40 px-2.5 py-2">
                            <p className="text-[9.5px] text-ink-4">{key}</p>
                            <p className="mt-0.5 break-words font-mono text-[10px] leading-[1.5] text-ink-2">
                              {formatValue(value)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selected.links.length > 0 ? (
                    <div className="border-t border-line px-4 py-3">
                      <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-ink-4">
                        Links
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selected.links.map((link) => (
                          <Chip key={`${link.target}-${link.label}`} tone="neutral">
                            {link.label}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </Panel>
          </section>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        label={`Create ${meta.name} ${meta.noun}`}
        width={560}
      >
        <div className="border-b border-line px-4 py-3.5">
          <h2 className="text-[14px] font-medium text-ink">New {meta.noun}</h2>
          <p className="mt-1 text-[11.5px] leading-[1.6] text-ink-3">
            Creating uses the independent create grant. {meta.name} validates the title and target.
          </p>
        </div>
        <div className="space-y-3 px-4 py-4">
          {connectorId === 'notion' ? (
            <>
              <TextField
                label="Parent page or data source ID"
                value={createParent}
                onChange={setCreateParent}
                placeholder="Page or data source ID"
                disabled={creating}
                maxLength={500}
                hint="The parent must be shared with the integration."
              />
              <SelectField
                label="Parent type"
                value={createParentType}
                options={PARENT_TYPE_OPTIONS}
                disabled={creating}
                onChange={setCreateParentType}
              />
            </>
          ) : null}
          {connectorId === 'anytype' ? (
            <TextField
              label="Object type key"
              value={createTypeKey}
              onChange={setCreateTypeKey}
              placeholder="page"
              disabled={creating}
              maxLength={100}
              hint="For example page, note or task. The type must exist in the selected space."
            />
          ) : null}
          <TextField
            label="Title"
            value={createTitle}
            onChange={setCreateTitle}
            placeholder={`${meta.name} ${meta.noun} title`}
            disabled={creating}
            maxLength={200}
            autoFocus
          />
          <TextAreaField
            label="Content"
            value={createContent}
            onChange={setCreateContent}
            placeholder="Markdown content"
            rows={8}
            disabled={creating}
            maxLength={200_000}
          />
          {connectorId === 'notion' || connectorId === 'anytype' ? (
            <TextAreaField
              label="Properties JSON (optional)"
              value={createProperties}
              onChange={setCreateProperties}
              placeholder='{"Status":"In progress"}'
              rows={3}
              disabled={creating}
              maxLength={20_000}
              hint="Simple values only. Keys must match properties on the target type or data source."
            />
          ) : null}
          {createError ? (
            <Note tone="danger" icon={<Icon name="warning" size={13} />}>
              {createError}
            </Note>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button size="sm" variant="ghost" disabled={creating} onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            disabled={creating}
            onClick={() => void submitCreate()}
          >
            {creating ? 'Creating…' : `Create ${meta.noun}`}
          </Button>
        </div>
      </Modal>

      <Modal
        open={appendOpen}
        onClose={() => {
          if (!appending) setAppendOpen(false);
        }}
        label={`Append to ${meta.name}`}
        width={560}
      >
        <div className="border-b border-line px-4 py-3.5">
          <h2 className="text-[14px] font-medium text-ink">Append content</h2>
          <p className="mt-1 text-[11.5px] leading-[1.6] text-ink-3">
            {selected?.title} · {selected?.path}
          </p>
        </div>
        <div className="space-y-3 px-4 py-4">
          <TextAreaField
            label="Markdown content"
            value={appendContent}
            onChange={setAppendContent}
            placeholder="Content to append"
            rows={8}
            disabled={appending}
            maxLength={200_000}
            autoFocus
          />
          {appendError ? (
            <Note tone="danger" icon={<Icon name="warning" size={13} />}>
              {appendError}
            </Note>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button size="sm" variant="ghost" disabled={appending} onClick={() => setAppendOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            disabled={appending || !appendContent.trim()}
            onClick={() => void submitAppend()}
          >
            {appending ? 'Appending…' : 'Append'}
          </Button>
        </div>
      </Modal>

      <Modal
        open={updateOpen}
        onClose={() => {
          if (!updating) setUpdateOpen(false);
        }}
        label={`Update ${meta.name} content`}
        width={560}
      >
        <div className="border-b border-line px-4 py-3.5">
          <h2 className="text-[14px] font-medium text-ink">Update {selected?.title}</h2>
          <p className="mt-1 text-[11.5px] leading-[1.6] text-ink-3">
            This changes existing application content. Review the fields and confirm deliberately.
          </p>
        </div>
        <div className="space-y-3 px-4 py-4">
          <Note tone="warn" icon={<Icon name="warning" size={13} />}>
            {connectorId === 'logseq'
              ? 'The selected block content is replaced. Other blocks are untouched.'
              : connectorId === 'anytype'
                ? 'The object name, body and supplied properties are replaced with these values.'
                : 'Supported properties and the title change. Page body content is not replaced.'}
          </Note>
          {connectorId === 'notion' ? (
            <>
              <TextField
                label="Title"
                value={updateName}
                onChange={setUpdateName}
                disabled={updating}
                maxLength={200}
              />
              <TextAreaField
                label="Properties JSON"
                value={updateProperties}
                onChange={setUpdateProperties}
                placeholder='{"Status":"Done"}'
                rows={4}
                disabled={updating}
                maxLength={20_000}
              />
            </>
          ) : null}
          {connectorId === 'logseq' ? (
            <>
              <TextField
                label="Block ID"
                value={updateBlockId}
                onChange={setUpdateBlockId}
                placeholder="Block UUID from read properties"
                disabled={updating}
                maxLength={100}
                hint="Read the page and copy a blockIds value when the target is not the first block."
              />
              <TextAreaField
                label="Replacement block content"
                value={updateContent}
                onChange={setUpdateContent}
                rows={6}
                disabled={updating}
                maxLength={200_000}
                autoFocus
              />
            </>
          ) : null}
          {connectorId === 'anytype' ? (
            <>
              <TextField
                label="Object name"
                value={updateName}
                onChange={setUpdateName}
                disabled={updating}
                maxLength={200}
              />
              <TextAreaField
                label="Markdown body"
                value={updateContent}
                onChange={setUpdateContent}
                rows={8}
                disabled={updating}
                maxLength={200_000}
                hint="The current body is prefilled. Clearing it will replace the object body with empty content."
              />
              <TextAreaField
                label="Properties JSON (optional)"
                value={updateProperties}
                onChange={setUpdateProperties}
                placeholder='{"Status":"Done"}'
                rows={3}
                disabled={updating}
                maxLength={20_000}
              />
            </>
          ) : null}
          {updateError ? (
            <Note tone="danger" icon={<Icon name="warning" size={13} />}>
              {updateError}
            </Note>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button size="sm" variant="ghost" disabled={updating} onClick={() => setUpdateOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon="edit"
            disabled={updating}
            onClick={() => void submitUpdate()}
          >
            {updating ? 'Updating…' : 'Confirm update'}
          </Button>
        </div>
      </Modal>

      <Modal
        open={dataSourceOpen}
        onClose={() => {
          if (!dataSourceBusy) setDataSourceOpen(false);
        }}
        label="Browse Notion data source"
        width={500}
      >
        <div className="border-b border-line px-4 py-3.5">
          <h2 className="text-[14px] font-medium text-ink">Browse a data source</h2>
          <p className="mt-1 text-[11.5px] leading-[1.6] text-ink-3">
            Current Notion API versions query data sources rather than database objects. The data
            source must be shared with the integration.
          </p>
        </div>
        <div className="space-y-3 px-4 py-4">
          <TextField
            label="Data source ID"
            value={dataSourceId}
            onChange={setDataSourceId}
            placeholder="Data source ID"
            disabled={dataSourceBusy}
            maxLength={200}
            autoFocus
          />
          {dataSourceError ? (
            <Note tone="danger" icon={<Icon name="warning" size={13} />}>
              {dataSourceError}
            </Note>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button
            size="sm"
            variant="ghost"
            disabled={dataSourceBusy}
            onClick={() => setDataSourceOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="storage"
            disabled={dataSourceBusy}
            onClick={() => void submitDataSource()}
          >
            {dataSourceBusy ? 'Loading…' : 'Load entries'}
          </Button>
        </div>
      </Modal>
    </ModulePage>
  );
}
