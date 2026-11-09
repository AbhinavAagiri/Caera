import type { IsoTimestamp } from './conversations.js';

/**
 * A source is a registered connector id. The index never invents a source or
 * accepts content for one that is not connected and explicitly enabled.
 */
export type KnowledgeSourceId = string;

export interface KnowledgeSourceRules {
  /** Indexing is opt-in for every source, separately from its read grant. */
  enabled: boolean;
  /** Case-insensitive text or glob patterns matched against path, title and id. */
  excludePaths: string[];
  /** Case-insensitive text or glob patterns matched against folder/type/category. */
  excludeCategories: string[];
  /** Tags are compared without the leading # and without case. */
  excludeTags: string[];
}

export interface KnowledgeSourceSettingsInput extends KnowledgeSourceRules {
  source: KnowledgeSourceId;
}

export interface KnowledgeSettingsInput {
  enabled: boolean;
  sources: KnowledgeSourceSettingsInput[];
}

export interface KnowledgeSettings {
  enabled: boolean;
  sources: Record<KnowledgeSourceId, KnowledgeSourceRules>;
  updatedAt: IsoTimestamp;
}

export type KnowledgeSourceStatus =
  | 'not-connected'
  | 'permission-required'
  | 'disabled'
  | 'unsupported'
  | 'never-indexed'
  | 'indexed'
  | 'error';

export interface KnowledgeSourceSummary {
  id: KnowledgeSourceId;
  name: string;
  status: KnowledgeSourceStatus;
  connected: boolean;
  readGranted: boolean;
  supportsIndexing: boolean;
  indexingEnabled: boolean;
  documents: number;
  chunks: number;
  lastAttemptAt: IsoTimestamp | null;
  lastIndexedAt: IsoTimestamp | null;
  lastError: string | null;
  truncated: boolean;
  changeDetection: 'timestamp+fingerprint' | 'unsupported';
  rules: KnowledgeSourceRules;
}

export interface KnowledgeStats {
  sources: number;
  documents: number;
  chunks: number;
  tags: number;
  lastIndexedAt: IsoTimestamp | null;
}

export interface KnowledgeSnapshot {
  connectorsEnabled: boolean;
  settings: KnowledgeSettings;
  sources: KnowledgeSourceSummary[];
  stats: KnowledgeStats;
  /** Semantic retrieval is deliberately not enabled in this step. */
  retrieval: {
    mode: 'keyword';
    semanticAvailable: false;
    detail: string;
  };
  updatedAt: IsoTimestamp;
}

export type KnowledgeSyncSourceStatus =
  | 'indexed'
  | 'partial'
  | 'unchanged'
  | 'skipped'
  | 'failed';

export interface KnowledgeSyncSourceResult {
  source: KnowledgeSourceId;
  name: string;
  status: KnowledgeSyncSourceStatus;
  documentsSeen: number;
  documentsIndexed: number;
  documentsSkipped: number;
  documentsRemoved: number;
  documentsFailed: number;
  truncated: boolean;
  detail: string;
}

export interface KnowledgeSyncResult {
  startedAt: IsoTimestamp;
  finishedAt: IsoTimestamp;
  sources: KnowledgeSyncSourceResult[];
  documentsIndexed: number;
  documentsSkipped: number;
  documentsFailed: number;
  failedSources: number;
}

export interface KnowledgeSyncInput {
  /** Omit to sync every enabled, connected source. */
  sources?: KnowledgeSourceId[];
}

export interface KnowledgeSearchInput {
  query: string;
  sources?: KnowledgeSourceId[];
  tags?: string[];
  /** YYYY-MM-DD or ISO date, inclusive. */
  updatedFrom?: string;
  /** YYYY-MM-DD or ISO date, inclusive. */
  updatedTo?: string;
  limit?: number;
}

export interface KnowledgeReference {
  label: string;
  source: KnowledgeSourceId;
  documentId: string;
  path: string;
  url: string | null;
}

export interface KnowledgeSearchHit {
  id: string;
  source: KnowledgeSourceId;
  sourceLabel: string;
  documentId: string;
  title: string;
  path: string;
  url: string | null;
  category: string;
  tags: string[];
  updatedAt: IsoTimestamp;
  indexedAt: IsoTimestamp;
  excerpt: string;
  score: number;
  reference: KnowledgeReference;
}

export interface KnowledgeSearchResult {
  query: string;
  hits: KnowledgeSearchHit[];
  total: number;
  truncated: boolean;
  retrieval: 'keyword';
  searchedAt: IsoTimestamp;
}

export interface KnowledgeClearInput {
  /** Omit to clear every indexed source while keeping its settings. */
  source?: KnowledgeSourceId;
}

export interface KnowledgeClearResult {
  source: KnowledgeSourceId | null;
  documentsRemoved: number;
  chunksRemoved: number;
}
