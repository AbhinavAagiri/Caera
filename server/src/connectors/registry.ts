import type { ConnectorDescriptor } from '@shared';
import { anytypeConnector } from './anytype';
import { logseqConnector } from './logseq';
import { notionConnector } from './notion';
import { obsidianConnector } from './obsidian';
import type { ConnectorAdapter } from './types';

const adapters = new Map<string, ConnectorAdapter>();

function register(adapter: ConnectorAdapter): void {
  if (adapters.has(adapter.descriptor.id)) {
    throw new Error(`A connector with id "${adapter.descriptor.id}" is already registered.`);
  }
  adapters.set(adapter.descriptor.id, adapter);
}

register(obsidianConnector);
register(notionConnector);
register(logseqConnector);
register(anytypeConnector);

export function getConnectorAdapter(id: string): ConnectorAdapter | null {
  return adapters.get(id) ?? null;
}

export function listConnectorAdapters(): ConnectorAdapter[] {
  return [...adapters.values()];
}

export function listConnectorDescriptors(): ConnectorDescriptor[] {
  return listConnectorAdapters()
    .map((adapter) => adapter.descriptor)
    .sort((left, right) => {
    if (left.availability !== right.availability) {
      return left.availability === 'available' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
    });
}
