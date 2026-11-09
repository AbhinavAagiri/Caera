import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  ConnectorDraftPreview,
  ConnectorNote,
  ConnectorNoteSummary,
  ConnectorOperationResult,
} from '@shared';
import { MarkdownMessage } from '@/components/conversation/MarkdownMessage';
import { Icon } from '@/components/icons/Icon';
import { ModulePage } from '@/components/layout/ModulePage';
import { Button, IconButton } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Controls';
import { Chip } from '@/components/ui/Indicators';
import { Modal } from '@/components/ui/Overlay';
import {
  Note,
  Panel,
  PanelHeader,
  RowGroup,
  SectionHeading,
  SettingRow,
} from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { useConnectors } from '@/hooks/useConnectors';
import { formatRelative, pluralize } from '@/lib/format';
import { api, toApiError } from '@/services/api';

const NAMING_LABEL: Record<string, string> = {
  'as-entered': 'As entered',
  'date-prefix': 'Date prefix',
  slug: 'Slug',
};

function errorMessage(cause: unknown): string {
  const error = toApiError(cause);
  return error.hint ? `${error.message} ${error.hint}` : error.message;
}

function noteBody(note: ConnectorNote): string {
  const raw = note.frontmatter.raw;
  if (raw && note.content.startsWith(raw)) {
    return note.content.slice(raw.length).replace(/^\r?\n/, '');
  }
  return note.content;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} kB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

async function runTool(
  operation: string,
  args: Record<string, unknown>,
  confirmed = false,
): Promise<ConnectorOperationResult> {
  const response = await api.executeConnectorTool(`obsidian.${operation}`, args, confirmed);
  return response.result;
}

export function ObsidianPage(): React.JSX.Element {
  const navigate = useNavigate();
  const node = useLocalNode();
  const { push } = useToast();
  const connectors = useConnectors();

  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [results, setResults] = useState<ConnectorNoteSummary[]>([]);
  const [resultTotal, setResultTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [listLoaded, setListLoaded] = useState(false);

  const [selected, setSelected] = useState<ConnectorNote | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);
  const [mode, setMode] = useState<'read' | 'edit' | 'append'>('read');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    type: 'update' | 'delete';
    note: ConnectorNote;
  } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createFolder, setCreateFolder] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createPreview, setCreatePreview] = useState<ConnectorDraftPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const didInitialSearch = useRef(false);

  const snapshot = connectors.snapshot;
  const integration = snapshot?.connectors.find((connector) => connector.id === 'obsidian') ?? null;
  const connected = integration?.connection.status === 'connected';
  const grants = integration?.grants ?? {
    read: false,
    create: false,
    edit: false,
    delete: false,
  };
  const config = integration?.connection.configuration ?? {};
  const ready = Boolean(connected && grants.read);

  const runSearch = useCallback(
    async (searchQuery: string, tag: string, folder: string): Promise<void> => {
      setSearching(true);
      setSearchError(null);
      try {
        const args: Record<string, unknown> = { query: searchQuery.trim(), limit: 30 };
        if (tag.trim()) args.tag = tag.trim();
        if (folder.trim()) args.folder = folder.trim();

        const result = await runTool('search', args);
        if (result.type !== 'search') {
          throw new Error('The vault returned an unexpected search result.');
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
    [],
  );

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
    void runSearch('', '', '');
  }, [ready, runSearch]);

  const loadNote = useCallback(
    async (path: string): Promise<void> => {
      setLoadingNote(true);
      setActionError(null);
      try {
        const result = await runTool('read', { path });
        if (result.type !== 'read') {
          throw new Error('The vault returned an unexpected note result.');
        }
        setSelected(result.note);
        setDraft(result.note.content);
        setMode('read');
      } catch (cause) {
        push('Could not read note', {
          detail: errorMessage(cause),
          tone: 'error',
        });
      } finally {
        setLoadingNote(false);
      }
    },
    [push],
  );

  const submitSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void runSearch(query, tagFilter, folderFilter);
  };

  const clearFilters = (): void => {
    setQuery('');
    setTagFilter('');
    setFolderFilter('');
    void runSearch('', '', '');
  };

  const refreshPage = (): void => {
    connectors.refresh();
    node.refresh();
    if (ready) void runSearch(query, tagFilter, folderFilter);
  };

  const openInObsidian = async (): Promise<void> => {
    if (!selected) return;
    try {
      const result = await runTool('open', { path: selected.path });
      if (result.type !== 'open') {
        throw new Error('The vault did not return an Obsidian link.');
      }
      const anchor = document.createElement('a');
      anchor.href = result.url;
      anchor.rel = 'noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      push('Opening in Obsidian', { detail: result.path, tone: 'success' });
    } catch (cause) {
      push('Could not prepare the Obsidian link', {
        detail: errorMessage(cause),
        tone: 'error',
      });
    }
  };

  const beginEdit = (): void => {
    if (!selected) return;
    if (!grants.edit) {
      push('Edit permission is off', {
        detail: 'Grant edit access in Connections before changing a note.',
        tone: 'error',
      });
      return;
    }
    setDraft(selected.content);
    setActionError(null);
    setMode('edit');
  };

  const beginAppend = (): void => {
    if (!selected) return;
    if (!grants.edit) {
      push('Edit permission is off', {
        detail: 'Grant edit access in Connections before appending to a note.',
        tone: 'error',
      });
      return;
    }
    setDraft('');
    setActionError(null);
    setMode('append');
  };

  const cancelMode = (): void => {
    setDraft(selected?.content ?? '');
    setActionError(null);
    setMode('read');
  };

  const submitAppend = async (): Promise<void> => {
    if (!selected || !draft.trim() || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const result = await runTool('append', {
        path: selected.path,
        content: draft,
      });
      if (result.type !== 'write') {
        throw new Error('The vault returned an unexpected write result.');
      }
      await loadNote(selected.path);
      await runSearch(query, tagFilter, folderFilter);
      push('Content appended', { detail: selected.path, tone: 'success' });
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const confirmPending = async (): Promise<void> => {
    if (!pendingAction || saving) return;
    const target = pendingAction;
    setSaving(true);
    setActionError(null);
    try {
      if (target.type === 'update') {
        const result = await runTool(
          'update',
          { path: target.note.path, content: draft },
          true,
        );
        if (result.type !== 'write') {
          throw new Error('The vault returned an unexpected write result.');
        }
        await loadNote(target.note.path);
        await runSearch(query, tagFilter, folderFilter);
        push('Note replaced', { detail: target.note.path, tone: 'success' });
      } else {
        const result = await runTool('delete', { path: target.note.path }, true);
        if (result.type !== 'delete') {
          throw new Error('The vault returned an unexpected delete result.');
        }
        setSelected(null);
        setDraft('');
        setMode('read');
        await runSearch(query, tagFilter, folderFilter);
        push('Note deleted', { detail: target.note.path, tone: 'success' });
      }
      setPendingAction(null);
    } catch (cause) {
      push(target.type === 'update' ? 'Could not replace note' : 'Could not delete note', {
        detail: errorMessage(cause),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const openCreate = (): void => {
    if (!grants.create) {
      push('Create permission is off', {
        detail: 'Grant create access in Connections before adding a note.',
        tone: 'error',
      });
      return;
    }
    setCreateOpen(true);
    setCreateTitle('');
    setCreateFolder(config.defaultNoteFolder ?? '');
    setCreateContent('');
    setCreatePreview(null);
    setCreateError(null);
  };

  const closeCreate = (): void => {
    if (creating) return;
    setCreateOpen(false);
    setCreatePreview(null);
    setCreateError(null);
  };

  const requestPreview = async (): Promise<void> => {
    if (!createTitle.trim() || previewing) {
      setCreateError('A note title is required.');
      return;
    }
    setPreviewing(true);
    setCreateError(null);
    try {
      const response = await api.previewConnectorDraft('obsidian', {
        title: createTitle.trim(),
        content: createContent,
        ...(createFolder.trim() ? { folder: createFolder.trim() } : {}),
      });
      setCreatePreview(response.preview);
    } catch (cause) {
      setCreatePreview(null);
      setCreateError(errorMessage(cause));
    } finally {
      setPreviewing(false);
    }
  };

  const submitCreate = async (): Promise<void> => {
    if (!createPreview || !createPreview.canCreate || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await runTool(
        'create',
        {
          title: createTitle.trim(),
          content: createContent,
          ...(createFolder.trim() ? { folder: createFolder.trim() } : {}),
        },
        createPreview.requiresConfirmation,
      );
      if (result.type !== 'write') {
        throw new Error('The vault returned an unexpected write result.');
      }

      setCreateOpen(false);
      setCreatePreview(null);
      await runSearch(query, tagFilter, folderFilter);
      await loadNote(result.note.path);
      push('Note created', { detail: result.note.path, tone: 'success' });
    } catch (cause) {
      setCreateError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  };

  const statusChip = connected ? <Chip tone="ok">Connected</Chip> : <Chip tone="neutral">Not connected</Chip>;
  const permissionSummary =
    [
      grants.read ? 'read' : null,
      grants.create ? 'create' : null,
      grants.edit ? 'edit' : null,
      grants.delete ? 'delete' : null,
    ]
      .filter(Boolean)
      .join(', ') || 'none';

  return (
    <ModulePage
      kicker={
        <>
          Integrations <span className="slash">/</span> <span className="accent">Obsidian vault</span>
        </>
      }
      title="Obsidian vault"
      description="Search and work with Markdown notes inside the folders you approved. Search returns excerpts, not the whole vault; writes stay explicit and confirmed."
      actions={
        <div className="flex items-center gap-2">
          {statusChip}
          <IconButton
            icon="refresh"
            label="Refresh vault"
            size="sm"
            onClick={refreshPage}
          />
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            disabled={!grants.create}
            onClick={openCreate}
          >
            New note
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
            <p className="font-serif text-[22px] leading-tight text-ink">Vault unavailable</p>
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
        <Panel>
          <div className="flex min-h-[360px] flex-col items-center justify-center px-6 py-12 text-center">
            <div className="relative mb-4 grid size-[72px] place-items-center rounded-full border border-line">
              <span
                className="absolute inset-[7px] rounded-full border border-dashed border-line"
                aria-hidden="true"
              />
              <Icon name="folder" size={23} className="text-ink-3" />
            </div>
            <p className="font-serif text-[24px] leading-tight text-ink">
              {integration?.connection.status === 'error'
                ? 'Obsidian needs attention'
                : 'Obsidian is not connected'}
            </p>
            <p className="mx-auto mt-1.5 max-w-[48ch] text-[11.5px] leading-[1.7] text-ink-3">
              {integration?.connection.lastError ??
                'Choose the folder Obsidian opens as a vault. Access is limited to Markdown notes in that folder and starts read-only.'}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                size="sm"
                variant="primary"
                icon="network"
                onClick={() => navigate('/connections')}
              >
                Open Connections
              </Button>
              {integration?.connection.status === 'error' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="refresh"
                  onClick={refreshPage}
                >
                  Retry check
                </Button>
              ) : null}
            </div>
          </div>
        </Panel>
      ) : !grants.read ? (
        <Panel>
          <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-12 text-center">
            <Icon name="shield" size={22} className="text-ink-3" />
            <p className="mt-3 font-serif text-[22px] leading-tight text-ink">
              Read permission is off
            </p>
            <p className="mt-1.5 max-w-[44ch] text-[11.5px] leading-[1.6] text-ink-3">
              The vault is connected, but this connector cannot search or read notes. Grant read
              access deliberately in Connections.
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon="network"
              className="mt-4"
              onClick={() => navigate('/connections')}
            >
              Manage permissions
            </Button>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-4">
            <Panel>
              <PanelHeader
                title="Search"
                description="Titles, contents, tags and folder paths. Empty search lists recent notes."
              />
              <form onSubmit={submitSearch} className="space-y-3 px-4 py-3.5">
                <TextField
                  label="Search vault"
                  value={query}
                  onChange={setQuery}
                  placeholder="Title, content, tag or path"
                  maxLength={200}
                  disabled={searching}
                />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <TextField
                    label="Tag"
                    value={tagFilter}
                    onChange={setTagFilter}
                    placeholder="project"
                    maxLength={80}
                    disabled={searching}
                  />
                  <TextField
                    label="Folder"
                    value={folderFilter}
                    onChange={setFolderFilter}
                    placeholder="Projects/CAERA"
                    maxLength={300}
                    disabled={searching}
                  />
                </div>
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
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={searching}
                    onClick={clearFilters}
                  >
                    Clear
                  </Button>
                </div>
              </form>
            </Panel>

            <section>
              <SectionHeading
                title="Notes"
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
                    <p className="mt-2 text-[12px] text-ink-2">No notes found</p>
                    <p className="mt-1 text-[11px] leading-[1.55] text-ink-3">
                      Try a broader search, another tag or a parent folder.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-[540px] divide-y divide-line overflow-y-auto">
                    {results.map((note) => {
                      const active = selected?.path === note.path;
                      return (
                        <button
                          key={note.path}
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
                              {formatRelative(note.updatedAt)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[9px] text-ink-4">
                            {note.path}
                          </p>
                          <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-[1.55] text-ink-3">
                            {note.excerpt || 'Empty note'}
                          </p>
                          {note.tags.length > 0 ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {note.tags.slice(0, 4).map((tag) => (
                                <Chip key={tag} tone="accent">
                                  #{tag}
                                </Chip>
                              ))}
                              {note.tags.length > 4 ? (
                                <span className="font-mono text-[8px] text-ink-4">
                                  +{note.tags.length - 4}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Panel>
              {listLoaded && resultTotal > results.length ? (
                <p className="mt-2 font-mono text-[8.5px] uppercase tracking-[0.04em] text-ink-4">
                  Showing {results.length} of {pluralize(resultTotal, 'matching note')}
                </p>
              ) : null}
            </section>

            <Panel>
              <PanelHeader
                title="Vault settings"
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="settings"
                    onClick={() => navigate('/connections')}
                  >
                    Edit
                  </Button>
                }
              />
              <RowGroup>
                <SettingRow label="Access" description={permissionSummary}>
                  <Chip tone={grants.create || grants.edit || grants.delete ? 'warn' : 'ok'}>
                    {grants.create || grants.edit || grants.delete ? 'write' : 'read-only'}
                  </Chip>
                </SettingRow>
                <SettingRow label="Accessible folders">
                  <span className="block max-w-[180px] break-all font-mono text-[9.5px] leading-[1.5] text-ink-3">
                    {config.includedFolders || 'Whole vault'}
                  </span>
                </SettingRow>
                <SettingRow label="Excluded folders">
                  <span className="block max-w-[180px] break-all font-mono text-[9.5px] leading-[1.5] text-ink-3">
                    {config.excludedFolders || 'None'}
                  </span>
                </SettingRow>
                <SettingRow label="Default note folder">
                  <span className="font-mono text-[9.5px] text-ink-3">
                    {config.defaultNoteFolder || 'Vault root'}
                  </span>
                </SettingRow>
                <SettingRow label="Note naming">
                  <span className="font-mono text-[9.5px] text-ink-3">
                    {NAMING_LABEL[config.noteNaming ?? 'as-entered'] ?? 'As entered'}
                  </span>
                </SettingRow>
                <SettingRow label="Trusted creation">
                  <Chip tone={config.trustedCreate === 'true' ? 'warn' : 'ok'}>
                    {config.trustedCreate === 'true' ? 'On' : 'Off'}
                  </Chip>
                </SettingRow>
              </RowGroup>
            </Panel>

            {!grants.create && !grants.edit && !grants.delete ? (
              <Note tone="accent" icon={<Icon name="shield" size={13} />}>
                Read-only. Creating, editing and deleting are off. Enable a write grant
                deliberately in Connections; destructive actions still confirm each time.
              </Note>
            ) : null}
          </aside>

          <div className="min-w-0">
            {loadingNote ? (
              <Panel>
                <div className="space-y-3 px-4 py-5" aria-hidden="true">
                  <div className="h-4 w-[42%] animate-pulse rounded bg-raised" />
                  <div className="h-3 w-[24%] animate-pulse rounded bg-raised" />
                  <div className="mt-5 h-[260px] animate-pulse rounded-[5px] border border-line bg-raised/40" />
                </div>
              </Panel>
            ) : !selected ? (
              <Panel>
                <div className="flex min-h-[520px] flex-col items-center justify-center px-6 py-12 text-center">
                  <div className="relative mb-4 grid size-[72px] place-items-center rounded-full border border-line">
                    <span
                      className="absolute inset-[7px] rounded-full border border-dashed border-line"
                      aria-hidden="true"
                    />
                    <Icon name="folder" size={22} className="text-ink-3" />
                  </div>
                  <p className="font-serif text-[25px] leading-tight text-ink">Open a note</p>
                  <p className="mx-auto mt-1.5 max-w-[46ch] text-[11.5px] leading-[1.7] text-ink-3">
                    Choose a search result to read its Markdown, frontmatter, tags and internal
                    links. Content is fetched one note at a time and never bundled into a prompt.
                  </p>
                  {grants.create ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="plus"
                      className="mt-4"
                      onClick={openCreate}
                    >
                      Create a note
                    </Button>
                  ) : null}
                </div>
              </Panel>
            ) : (
              <Panel>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-[17px] font-medium leading-tight text-ink">
                        {selected.title}
                      </h2>
                      <Chip tone="neutral">{selected.folder || 'vault root'}</Chip>
                      {selected.truncated ? <Chip tone="warn">truncated</Chip> : null}
                    </div>
                    <p className="mt-1.5 break-all font-mono text-[9.5px] leading-[1.5] text-ink-4">
                      {selected.path}
                    </p>
                    <p className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.04em] text-ink-4">
                      updated {formatRelative(selected.updatedAt)} · {formatBytes(selected.sizeBytes)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      icon="external"
                      label="Open in Obsidian"
                      size="sm"
                      onClick={() => void openInObsidian()}
                    />
                    <IconButton
                      icon="edit"
                      label="Edit full note"
                      size="sm"
                      disabled={!grants.edit}
                      onClick={beginEdit}
                    />
                    <IconButton
                      icon="trash"
                      label="Delete note"
                      size="sm"
                      disabled={!grants.delete}
                      onClick={() => setPendingAction({ type: 'delete', note: selected })}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="plus"
                    disabled={!grants.edit || saving}
                    onClick={beginAppend}
                  >
                    Append
                  </Button>
                  {selected.tags.map((tag) => (
                    <Chip key={tag} tone="accent">
                      #{tag}
                    </Chip>
                  ))}
                  {selected.tags.length === 0 ? (
                    <span className="font-mono text-[8.5px] uppercase tracking-[0.04em] text-ink-4">
                      no tags
                    </span>
                  ) : null}
                </div>

                {mode === 'read' ? (
                  <>
                    {selected.truncated ? (
                      <div className="border-b border-line px-4 py-2.5">
                        <Note tone="warn" icon={<Icon name="warning" size={13} />}>
                          This note is larger than the 256 kB read cap. The content below is
                          truncated; the file on disk was not changed.
                        </Note>
                      </div>
                    ) : null}

                    {selected.frontmatter.raw ? (
                      <details className="border-b border-line px-4 py-3">
                        <summary className="cursor-pointer text-[11px] text-ink-3">
                          Frontmatter · {Object.keys(selected.frontmatter.values).length} keys
                        </summary>
                        <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-[5px] border border-line bg-base/50 p-2.5 font-mono text-[10px] leading-[1.6] text-ink-2">
                          {selected.frontmatter.raw}
                        </pre>
                      </details>
                    ) : null}

                    {selected.links.length > 0 ? (
                      <div className="border-b border-line px-4 py-3">
                        <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-ink-4">
                          Internal links
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {selected.links.map((link, index) => (
                            <button
                              key={`${link.kind}-${link.raw}-${index}`}
                              type="button"
                              disabled={!link.resolvedPath}
                              onClick={() => {
                                if (link.resolvedPath) void loadNote(link.resolvedPath);
                              }}
                              title={link.resolvedPath ?? 'Unresolved link'}
                              className={`inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-1 font-mono text-[8.5px] t-ui ${
                                link.resolvedPath
                                  ? 'border-line bg-raised text-ink-2 hover:border-line-strong hover:text-ink'
                                  : 'border-line bg-base/40 text-ink-4'
                              }`}
                            >
                              <Icon
                                name={link.resolvedPath ? 'node' : 'external'}
                                size={10}
                              />
                              {link.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="px-4 py-4">
                      {noteBody(selected).trim() ? (
                        <MarkdownMessage content={noteBody(selected)} />
                      ) : (
                        <p className="text-[11.5px] leading-[1.6] text-ink-3">
                          This note has no body content yet.
                        </p>
                      )}
                    </div>
                  </>
                ) : mode === 'edit' ? (
                  <div className="px-4 py-3.5">
                    <TextAreaField
                      label="Full note content"
                      value={draft}
                      onChange={setDraft}
                      rows={18}
                      maxLength={200_000}
                      disabled={saving}
                      hint="Replacing replaces the entire file, including frontmatter. The write needs a separate confirmation."
                    />
                    {actionError ? (
                      <p className="mt-2 text-[11px] leading-[1.55] text-danger">{actionError}</p>
                    ) : null}
                    <div className="mt-3 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" disabled={saving} onClick={cancelMode}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        icon="check"
                        disabled={saving || draft === selected.content}
                        onClick={() => setPendingAction({ type: 'update', note: selected })}
                      >
                        Review replacement
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-3.5">
                    <TextAreaField
                      label="Append content"
                      value={draft}
                      onChange={setDraft}
                      rows={8}
                      maxLength={200_000}
                      disabled={saving}
                      hint="Added after the existing content. Frontmatter and earlier notes stay untouched."
                    />
                    {actionError ? (
                      <p className="mt-2 text-[11px] leading-[1.55] text-danger">{actionError}</p>
                    ) : null}
                    <div className="mt-3 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" disabled={saving} onClick={cancelMode}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        icon="plus"
                        disabled={saving || !draft.trim()}
                        onClick={() => void submitAppend()}
                      >
                        {saving ? 'Appending…' : 'Append content'}
                      </Button>
                    </div>
                  </div>
                )}
              </Panel>
            )}

            <div className="mt-3">
              <Note icon={<Icon name="shield" size={13} />}>
                Reads and searches stay inside the approved vault. The node rejects traversal,
                reserved folders and symlinks that leave the vault. Search excerpts are bounded;
                note bodies are returned only for the note you open.
              </Note>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={closeCreate}
        label="Create an Obsidian note"
        width={660}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5">
          <div>
            <h2 className="text-[14px] font-medium text-ink">Create a note</h2>
            <p className="mt-1 text-[11.5px] leading-[1.55] text-ink-3">
              Preview the exact path and content before anything is written.
            </p>
          </div>
          <IconButton
            icon="close"
            label="Close note creation"
            size="sm"
            disabled={creating}
            onClick={closeCreate}
          />
        </div>

        <div className="space-y-3.5 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <TextField
              label="Title"
              value={createTitle}
              onChange={(value) => {
                setCreateTitle(value);
                setCreatePreview(null);
              }}
              placeholder="Weekly review"
              maxLength={200}
              disabled={creating}
              autoFocus
            />
            <TextField
              label="Folder"
              value={createFolder}
              onChange={(value) => {
                setCreateFolder(value);
                setCreatePreview(null);
              }}
              placeholder={config.defaultNoteFolder || 'Vault root'}
              hint="Leave empty for the vault root."
              maxLength={300}
              disabled={creating}
            />
          </div>

          <TextAreaField
            label="Content"
            value={createContent}
            onChange={(value) => {
              setCreateContent(value);
              setCreatePreview(null);
            }}
            rows={7}
            maxLength={200_000}
            placeholder={'---\ntags: [inbox]\n---\n\n# Weekly review\n'}
            disabled={creating}
            hint="Markdown and frontmatter are written exactly as entered."
          />

          {createPreview ? (
            <div className="rounded-[5px] border border-line bg-base/50 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="break-all font-mono text-[10.5px] text-ink-2">
                  {createPreview.path}
                </p>
                <div className="flex gap-1.5">
                  <Chip tone={createPreview.exists ? 'danger' : 'ok'}>
                    {createPreview.exists ? 'exists' : 'will create'}
                  </Chip>
                  <Chip tone={createPreview.requiresConfirmation ? 'warn' : 'accent'}>
                    {createPreview.requiresConfirmation ? 'confirm' : 'trusted'}
                  </Chip>
                </div>
              </div>
              {createPreview.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {createPreview.warnings.map((warning) => (
                    <li key={warning} className="text-[10.5px] leading-[1.5] text-warn">
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}
              <pre className="mt-2 max-h-[170px] overflow-auto whitespace-pre-wrap break-words rounded-[4px] border border-line bg-surface p-2 font-mono text-[10px] leading-[1.6] text-ink-3">
                {createPreview.content || '(empty note)'}
              </pre>
            </div>
          ) : null}

          {createError ? (
            <p className="rounded-[5px] border border-[color-mix(in_oklab,var(--c-danger)_24%,transparent)] bg-[color-mix(in_oklab,var(--c-danger)_7%,transparent)] px-3 py-2 text-[11.5px] leading-[1.55] text-danger">
              {createError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="max-w-[36ch] text-[10.5px] leading-[1.5] text-ink-4">
            {config.trustedCreate === 'true'
              ? 'Trusted creation is on. The preview is shown, but no extra confirmation is required.'
              : 'Creation needs confirmation after the preview unless trusted creation is enabled.'}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={creating} onClick={closeCreate}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="search"
              disabled={creating || previewing || !createTitle.trim()}
              onClick={() => void requestPreview()}
            >
              {previewing ? 'Previewing…' : createPreview ? 'Preview again' : 'Preview'}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon="check"
              disabled={creating || !createPreview || !createPreview.canCreate}
              onClick={() => void submitCreate()}
            >
              {creating ? 'Creating…' : 'Create note'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(pendingAction)}
        onClose={() => {
          if (!saving) setPendingAction(null);
        }}
        label={pendingAction?.type === 'delete' ? 'Delete note' : 'Replace note content'}
        width={480}
      >
        <div className="border-b border-line px-4 py-3.5">
          <h2 className="text-[14px] font-medium text-ink">
            {pendingAction?.type === 'delete' ? 'Delete this note?' : 'Replace the entire note?'}
          </h2>
          <p className="mt-1.5 text-[12px] leading-[1.65] text-ink-3">
            {pendingAction?.type === 'delete'
              ? 'The Markdown file is removed from the vault. This cannot be undone by CAERA.'
              : 'The file is rewritten with the content in the editor, including frontmatter. The previous content is not kept by CAERA.'}
          </p>
        </div>
        <div className="space-y-3 px-4 py-4">
          <p className="break-all rounded-[5px] border border-line bg-base/50 px-3 py-2 font-mono text-[10.5px] leading-[1.5] text-ink-2">
            {pendingAction?.note.path}
          </p>
          <Note tone="warn" icon={<Icon name="warning" size={13} />}>
            This confirmation is separate from the connector permission and cannot be skipped by a
            trusted-creation setting.
          </Note>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => setPendingAction(null)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant={pendingAction?.type === 'delete' ? 'danger' : 'primary'}
            icon={pendingAction?.type === 'delete' ? 'trash' : 'check'}
            disabled={saving}
            onClick={() => void confirmPending()}
          >
            {saving
              ? 'Working…'
              : pendingAction?.type === 'delete'
                ? 'Delete note'
                : 'Replace content'}
          </Button>
        </div>
      </Modal>
    </ModulePage>
  );
}
