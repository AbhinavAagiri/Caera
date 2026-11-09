import type { IsoTimestamp } from './conversations.js';

export type ToolId = 'files' | 'clipboard' | 'applications' | 'shell' | 'screen';
export type PermissionLevel = 'allow' | 'ask' | 'block';
export type ToolRisk = 'low' | 'medium' | 'high';

export interface ToolDefinition {
  id: ToolId;
  label: string;
  summary: string;
  detail: string;
  risk: ToolRisk;
  availability: 'planned' | 'available';
  level: PermissionLevel;
}

export interface PermissionSnapshot {
  tools: ToolDefinition[];
  updatedAt: IsoTimestamp | null;
}

export interface SetPermissionInput {
  level: PermissionLevel;
}
