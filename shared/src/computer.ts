import type { IsoTimestamp } from './conversations.js';

export type ComputerOperationId =
  | 'applications.open'
  | 'websites.open'
  | 'files.search'
  | 'files.read'
  | 'files.create'
  | 'files.open'
  | 'files.reveal'
  | 'system.info';

export type ComputerRisk = 'low' | 'medium' | 'high';

export interface ComputerOperationDefinition {
  id: ComputerOperationId;
  label: string;
  description: string;
  risk: ComputerRisk;
  /** Consequential operations cannot have confirmation disabled. */
  confirmationRequired: boolean;
}

export interface ComputerOperationPolicy {
  enabled: boolean;
  requiresConfirmation: boolean;
}

export interface ApprovedApplication {
  id: string;
  label: string;
  path: string;
}

export interface ApprovedDirectory {
  id: string;
  path: string;
  canRead: boolean;
  canCreate: boolean;
}

export interface ComputerSettings {
  enabled: boolean;
  operations: Record<ComputerOperationId, ComputerOperationPolicy>;
  applications: ApprovedApplication[];
  directories: ApprovedDirectory[];
  updatedAt: IsoTimestamp;
}

export interface ComputerApplicationInput {
  path: string;
  label?: string;
}

export interface ComputerDirectoryInput {
  path: string;
  canRead: boolean;
  canCreate: boolean;
}

export interface ComputerSettingsInput {
  enabled: boolean;
  operations: Record<ComputerOperationId, ComputerOperationPolicy>;
  applications: ComputerApplicationInput[];
  directories: ComputerDirectoryInput[];
}

export interface ComputerActionRecord {
  id: string;
  operation: string;
  status: 'completed' | 'failed' | 'denied';
  summary: string;
  startedAt: IsoTimestamp;
  finishedAt: IsoTimestamp | null;
}

export interface ComputerSnapshot {
  settings: ComputerSettings;
  operations: ComputerOperationDefinition[];
  history: ComputerActionRecord[];
}

export interface ComputerOperationRequest {
  operation: ComputerOperationId;
  arguments: Record<string, unknown>;
  confirmed?: boolean;
}

export interface ComputerActionPlan {
  operation: ComputerOperationId;
  label: string;
  summary: string;
  requiresConfirmation: boolean;
  arguments: Record<string, unknown>;
}

export interface ComputerOperationResult {
  operation: ComputerOperationId;
  status: 'completed';
  summary: string;
  data: unknown;
  startedAt: IsoTimestamp;
  finishedAt: IsoTimestamp;
}
