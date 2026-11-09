import { readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  ConnectorDirectoryEntry,
  ConnectorDirectoryListing,
  ConnectorDirectoryRoot,
} from '@shared';
import { env } from '../config/env';
import { getConnectorAdapter } from '../connectors/registry';
import { HttpError } from '../middleware/errors';

const MAX_DIRECTORY_ENTRIES = 400;

function asDirectory(candidate: string): string | null {
  try {
    if (!statSync(candidate).isDirectory()) return null;
    return realpathSync(candidate);
  } catch {
    return null;
  }
}

function dedupeRoots(roots: ConnectorDirectoryRoot[]): ConnectorDirectoryRoot[] {
  const seen = new Set<string>();
  const result: ConnectorDirectoryRoot[] = [];
  for (const root of roots) {
    const key = process.platform === 'win32' ? root.path.toLowerCase() : root.path;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(root);
  }
  return result;
}

/**
 * Starting points offered by the local picker. This endpoint lists folders for
 * the human choosing a vault; it is never exposed to the model and never reads
 * a file's contents.
 */
function directoryRoots(): ConnectorDirectoryRoot[] {
  const roots: ConnectorDirectoryRoot[] = [];
  const home = asDirectory(homedir());
  if (home) roots.push({ label: 'Home', path: home });

  for (const name of ['Desktop', 'Documents', 'Downloads']) {
    const folder = asDirectory(path.join(homedir(), name));
    if (folder) roots.push({ label: name, path: folder });
  }

  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = asDirectory(`${letter}:\\`);
      if (drive) roots.push({ label: `${letter}:`, path: drive });
    }
  } else {
    const filesystemRoot = asDirectory('/');
    if (filesystemRoot) roots.push({ label: '/', path: filesystemRoot });
  }

  return dedupeRoots(roots);
}

function listingFor(current: string): ConnectorDirectoryListing {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    throw new HttpError(
      400,
      'CONNECTOR_DIRECTORY_UNREADABLE',
      'That folder could not be read.',
      'Choose a folder the local node can access.',
    );
  }

  const directories: ConnectorDirectoryEntry[] = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => ({
      name: entry.name,
      path: path.join(current, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const parentPath = path.dirname(current);

  return {
    path: current,
    parent: parentPath === current ? null : parentPath,
    roots: directoryRoots(),
    directories: directories.slice(0, MAX_DIRECTORY_ENTRIES),
    truncated: directories.length > MAX_DIRECTORY_ENTRIES,
  };
}

/**
 * Directory-only browsing for a local-folder connector. It returns child
 * folder names, never files, and is bound to the loopback client by the API's
 * existing host/origin checks. Adapters that use a remote transport are
 * rejected.
 */
export function listConnectorDirectories(
  connectorId: string,
  rawPath: string | undefined,
): ConnectorDirectoryListing {
  if (!env.connectors.enabled) {
    throw new HttpError(
      409,
      'CONNECTOR_DISABLED',
      'Connections are disabled on this local node.',
      'Set CAERA_CONNECTORS_ENABLED=true and restart the node.',
    );
  }

  const adapter = getConnectorAdapter(connectorId);
  if (!adapter) {
    throw new HttpError(404, 'CONNECTOR_NOT_FOUND', 'That connector is not registered.');
  }
  if (adapter.descriptor.auth.method !== 'local-folder') {
    throw new HttpError(
      409,
      'CONNECTOR_DIRECTORY_UNSUPPORTED',
      `${adapter.descriptor.name} does not use a local folder.`,
    );
  }

  if (rawPath === undefined || !rawPath.trim()) {
    const fallback = asDirectory(homedir()) ?? directoryRoots()[0]?.path;
    if (!fallback) {
      throw new HttpError(
        500,
        'CONNECTOR_DIRECTORY_UNREADABLE',
        'No starting folder is available on this machine.',
      );
    }
    return listingFor(fallback);
  }

  if (!path.isAbsolute(rawPath)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'The folder path must be absolute.',
      'Start from a root supplied by the picker.',
    );
  }

  const current = asDirectory(rawPath);
  if (!current) {
    throw new HttpError(
      400,
      'CONNECTOR_DIRECTORY_UNREADABLE',
      'That folder does not exist or is not readable.',
      'Choose an existing folder, then retry.',
    );
  }

  return listingFor(current);
}
