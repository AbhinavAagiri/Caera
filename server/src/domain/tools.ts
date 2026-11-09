import type { PermissionLevel, ToolId } from '@shared';

export const DEFAULT_PERMISSIONS: Record<ToolId, PermissionLevel> = {
  files: 'ask',
  clipboard: 'ask',
  applications: 'block',
  shell: 'block',
  screen: 'block',
};

export interface ToolCatalogEntry {
  id: ToolId;
  label: string;
  summary: string;
  detail: string;
  risk: 'low' | 'medium' | 'high';
  availability: 'planned' | 'available';
}

export const TOOL_CATALOG: ReadonlyArray<ToolCatalogEntry> = [
  {
    id: 'files',
    label: 'Files and folders',
    summary: 'Read and write documents inside folders you approve',
    detail:
      'Every path is checked against the approved directory list before it is touched. The tool runtime that uses this permission is not built yet.',
    risk: 'medium',
    availability: 'planned',
  },
  {
    id: 'clipboard',
    label: 'Clipboard',
    summary: 'Read what you copied and place text on the clipboard',
    detail:
      'Useful for turning copied text into notes or memory entries. Only acts while a conversation is open.',
    risk: 'low',
    availability: 'planned',
  },
  {
    id: 'applications',
    label: 'Applications',
    summary: 'Launch and focus desktop applications',
    detail:
      'Lets CAERA open a program you name. It will never close programs or change system settings.',
    risk: 'medium',
    availability: 'planned',
  },
  {
    id: 'shell',
    label: 'PowerShell commands',
    summary: 'Run a command after you approve the exact text',
    detail:
      'Highest risk. Commands are shown in full before they run and are limited to the working directory you set.',
    risk: 'high',
    availability: 'planned',
  },
  {
    id: 'screen',
    label: 'Screen context',
    summary: 'Capture a screenshot or the active window title',
    detail:
      'Used for on-screen questions. Captures stay in memory and are discarded after the turn unless you save them.',
    risk: 'medium',
    availability: 'planned',
  },
];
