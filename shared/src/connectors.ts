import type { IsoTimestamp } from './conversations.js';

/** Operations a connector may implement. A descriptor only lists what it supports. */
export type ConnectorCapability =
  | 'search'
  | 'read'
  | 'create'
  | 'append'
  | 'update'
  | 'delete'
  | 'open';

/** Independent access grants for one connector. Read is the only default grant. */
export type ConnectorPermissionKind = 'read' | 'create' | 'edit' | 'delete';

export type ConnectorAvailability = 'available' | 'planned';
export type ConnectorAuthMethod = 'local-folder' | 'oauth' | 'api-key' | 'local-api';
export type ConnectorConnectionStatus = 'connected' | 'disconnected' | 'error';
export type ConnectorViewStatus = ConnectorConnectionStatus | 'not-connected' | 'planned';

export interface ConnectorConfigOption {
  value: string;
  label: string;
}

export interface ConnectorConfigField {
  key: string;
  label: string;
  type: 'text' | 'path' | 'url' | 'secret' | 'select' | 'boolean';
  required: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string;
  multiline?: boolean;
  options?: ConnectorConfigOption[];
}

export interface ConnectorAuthAlternative {
  method: ConnectorAuthMethod;
  label: string;
  description: string;
  requiresPlugin?: boolean;
}

export interface ConnectorAuthDefinition {
  method: ConnectorAuthMethod;
  label: string;
  description: string;
  fields: ConnectorConfigField[];
  /** Future transports that can share the same connector tools. */
  alternatives?: ConnectorAuthAlternative[];
}

export interface ConnectorOperationArgument {
  name: string;
  type: 'string' | 'integer' | 'boolean';
  description: string;
  required: boolean;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

export interface ConnectorOperationDefinition {
  /** Stable operation id within this connector, for example `search`. */
  id: string;
  capability: ConnectorCapability;
  label: string;
  description: string;
  permission: ConnectorPermissionKind;
  /** Destructive operations require a separate confirmation at execution time. */
  destructive: boolean;
  arguments: ConnectorOperationArgument[];
}

export interface ConnectorDescriptor {
  id: string;
  name: string;
  vendor: string;
  description: string;
  availability: ConnectorAvailability;
  availabilityDetail: string;
  auth: ConnectorAuthDefinition;
  capabilities: ConnectorCapability[];
  permissions: ConnectorPermissionKind[];
  operations: ConnectorOperationDefinition[];
}

export interface ConnectorGrantSet {
  read: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export interface ConnectorConnectionView {
  status: ConnectorViewStatus;
  /** Non-secret configuration only. Secret values are never serialized. */
  configuration: Record<string, string>;
  hasCredentials: boolean;
  connectedAt: IsoTimestamp | null;
  lastCheckedAt: IsoTimestamp | null;
  lastUsedAt: IsoTimestamp | null;
  lastError: string | null;
}

export interface ConnectorIntegration extends ConnectorDescriptor {
  connection: ConnectorConnectionView;
  grants: ConnectorGrantSet;
}

export interface ConnectorToolParameterSchema {
  type: 'string' | 'integer' | 'boolean';
  description: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

export interface ConnectorToolInputSchema {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, ConnectorToolParameterSchema>;
  required: string[];
}

/** A model-safe definition. The executor accepts only these ids and validates every argument. */
export interface ConnectorToolDefinition {
  id: string;
  connectorId: string;
  connectorName: string;
  operation: string;
  capability: ConnectorCapability;
  label: string;
  description: string;
  permission: ConnectorPermissionKind;
  destructive: boolean;
  inputSchema: ConnectorToolInputSchema;
}

export interface ConnectorToolListResult {
  tools: ConnectorToolDefinition[];
}

export interface ConnectorSnapshot {
  /** False when CAERA_CONNECTORS_ENABLED disables connection management. */
  enabled: boolean;
  connectors: ConnectorIntegration[];
  tools: ConnectorToolDefinition[];
  connected: number;
  available: number;
  updatedAt: IsoTimestamp;
}

export interface ConnectorConnectInput {
  configuration: Record<string, string>;
}

export interface ConnectorPermissionInput extends ConnectorGrantSet {
  /** Required when enabling any write grant. The UI asks the user first. */
  confirmWriteAccess?: boolean;
}

export interface ConnectorTestResult {
  connectorId: string;
  status: ConnectorConnectionStatus;
  detail: string;
  checkedAt: IsoTimestamp;
  noteCount?: number;
}

export type ConnectorFrontmatterValue =
  | string
  | number
  | boolean
  | string[]
  | null;

export interface ConnectorFrontmatter {
  /** Exact frontmatter block, including its `---` delimiters; empty when absent. */
  raw: string;
  values: Record<string, ConnectorFrontmatterValue>;
}

export interface ConnectorNoteLink {
  raw: string;
  target: string;
  label: string;
  kind: 'wikilink' | 'markdown';
  /** Vault-relative note path when the link resolves to a note. */
  resolvedPath: string | null;
}

export interface ConnectorNoteSummary {
  path: string;
  title: string;
  folder: string;
  excerpt: string;
  tags: string[];
  updatedAt: IsoTimestamp;
  sizeBytes: number;
}

export interface ConnectorNote extends ConnectorNoteSummary {
  content: string;
  truncated: boolean;
  frontmatter: ConnectorFrontmatter;
  links: ConnectorNoteLink[];
}

export interface ConnectorDraftInput {
  title: string;
  content: string;
  folder?: string;
}

export interface ConnectorDraftPreview {
  path: string;
  content: string;
  exists: boolean;
  canCreate: boolean;
  requiresConfirmation: boolean;
  warnings: string[];
}

export interface ConnectorDirectoryEntry {
  name: string;
  path: string;
}

export interface ConnectorDirectoryRoot {
  label: string;
  path: string;
}

export interface ConnectorDirectoryListing {
  path: string;
  parent: string | null;
  roots: ConnectorDirectoryRoot[];
  directories: ConnectorDirectoryEntry[];
  truncated: boolean;
}

export type ConnectorOperationResult =
  | { type: 'search'; notes: ConnectorNoteSummary[]; total: number; truncated: boolean }
  | { type: 'read'; note: ConnectorNote }
  | { type: 'write'; note: ConnectorNoteSummary; created: boolean }
  | { type: 'delete'; path: string }
  | { type: 'open'; path: string; url: string };
