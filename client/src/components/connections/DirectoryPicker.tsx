import { useEffect, useState } from 'react';
import type { ConnectorDirectoryListing } from '@shared';
import { Icon } from '@/components/icons/Icon';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Overlay';
import { api, toApiError } from '@/services/api';

export function DirectoryPicker({
  open,
  connectorId,
  initialPath,
  onClose,
  onSelect,
}: {
  open: boolean;
  connectorId: string;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}): React.JSX.Element {
  const [listing, setListing] = useState<ConnectorDirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let alive = true;

    setLoading(true);
    setError(null);
    api
      .connectorDirectories(connectorId, initialPath?.trim() || undefined, controller.signal)
      .then((next) => {
        if (!alive) return;
        setListing(next);
      })
      .catch((cause) => {
        if (!alive || cause instanceof DOMException) return;
        const apiError = toApiError(cause);
        setError(apiError.hint ? `${apiError.message} ${apiError.hint}` : apiError.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [connectorId, initialPath, open]);

  const browse = (path: string): void => {
    setLoading(true);
    setError(null);
    api
      .connectorDirectories(connectorId, path)
      .then(setListing)
      .catch((cause) => {
        const apiError = toApiError(cause);
        setError(apiError.hint ? `${apiError.message} ${apiError.hint}` : apiError.message);
      })
      .finally(() => setLoading(false));
  };

  return (
    <Modal open={open} onClose={onClose} label="Choose a vault folder" width={560}>
      <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5">
        <div>
          <h2 className="text-[14px] font-medium text-ink">Choose a vault folder</h2>
          <p className="mt-1 text-[11.5px] leading-[1.55] text-ink-3">
            Only folders are listed. CAERA never reads files during selection and never browses this
            path on its own.
          </p>
        </div>
        <IconButton icon="close" label="Close folder picker" size="sm" onClick={onClose} />
      </div>

      <div className="border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon name="folder" size={14} className="shrink-0 text-ink-3" />
          <p className="min-w-0 flex-1 break-all font-mono text-[10.5px] leading-[1.5] text-ink-2">
            {listing?.path ?? 'Loading…'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
        {(listing?.roots ?? []).map((root) => (
          <button
            key={root.path}
            type="button"
            disabled={loading}
            onClick={() => browse(root.path)}
            className="rounded-[4px] border border-line bg-raised px-2 py-1 font-mono text-[9px] uppercase tracking-[0.03em] text-ink-3 t-ui hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            {root.label}
          </button>
        ))}
      </div>

      <div className="min-h-[220px] max-h-[320px] overflow-y-auto">
        {error ? (
          <div className="px-4 py-6">
            <p className="rounded-[5px] border border-[color-mix(in_oklab,var(--c-danger)_24%,transparent)] bg-[color-mix(in_oklab,var(--c-danger)_7%,transparent)] px-3 py-2 text-[11.5px] leading-[1.55] text-danger">
              {error}
            </p>
          </div>
        ) : loading && !listing ? (
          <div className="space-y-2 px-4 py-5" aria-hidden="true">
            <div className="h-3 w-[48%] animate-pulse rounded bg-raised" />
            <div className="h-3 w-[66%] animate-pulse rounded bg-raised" />
            <div className="h-3 w-[38%] animate-pulse rounded bg-raised" />
          </div>
        ) : listing ? (
          <div className="p-1.5">
            {listing.parent ? (
              <button
                type="button"
                onClick={() => browse(listing.parent ?? '')}
                className="flex w-full items-center gap-2 rounded-[5px] px-2.5 py-2 text-left text-[12px] text-ink-3 t-ui hover:bg-raised hover:text-ink"
              >
                <Icon name="chevronLeft" size={13} />
                Parent folder
              </button>
            ) : null}

            {listing.directories.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-[11.5px] text-ink-3">
                No subfolders here. You can select this folder itself.
              </p>
            ) : (
              listing.directories.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => browse(entry.path)}
                  className="flex w-full items-center gap-2 rounded-[5px] px-2.5 py-2 text-left text-[12px] text-ink-2 t-ui hover:bg-raised hover:text-ink"
                >
                  <Icon name="folder" size={14} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  <Icon name="chevronRight" size={12} className="shrink-0 text-ink-4" />
                </button>
              ))
            )}

            {listing.truncated ? (
              <p className="px-2.5 py-2 font-mono text-[9px] uppercase tracking-[0.04em] text-ink-4">
                Listing truncated at 400 folders
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        <p className="max-w-[34ch] text-[10.5px] leading-[1.5] text-ink-4">
          Select the folder Obsidian opens as a vault.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="check"
            disabled={!listing || loading}
            onClick={() => {
              if (listing) onSelect(listing.path);
            }}
          >
            Use this folder
          </Button>
        </div>
      </div>
    </Modal>
  );
}
