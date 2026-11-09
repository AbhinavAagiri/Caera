import type { ComputerOperationId, ComputerOperationPolicy } from '@shared';

export interface ComputerOperationDefinitionInternal {
  id: ComputerOperationId;
  label: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
  confirmationRequired: boolean;
}

export const COMPUTER_OPERATIONS: ReadonlyArray<ComputerOperationDefinitionInternal> = [
  {
    id: 'applications.open',
    label: 'Open an approved application',
    description: 'Launch one executable explicitly saved in the approved applications list. No arguments, scripts or shell are involved.',
    risk: 'medium',
    confirmationRequired: true,
  },
  {
    id: 'websites.open',
    label: 'Open a website',
    description: 'Hand one public http(s) URL to the default browser after showing the exact address.',
    risk: 'medium',
    confirmationRequired: true,
  },
  {
    id: 'files.search',
    label: 'Search approved folders',
    description: 'Search file names and relative paths inside a read-approved directory. Symlinks and non-approved roots are skipped.',
    risk: 'low',
    confirmationRequired: false,
  },
  {
    id: 'files.read',
    label: 'Read an approved file',
    description: 'Read a bounded UTF-8 text file inside a read-approved directory after resolving its real path.',
    risk: 'low',
    confirmationRequired: false,
  },
  {
    id: 'files.create',
    label: 'Create a file in an approved folder',
    description: 'Create one new text file inside a directory explicitly approved for creation. Existing files are never overwritten.',
    risk: 'medium',
    confirmationRequired: true,
  },
  {
    id: 'files.open',
    label: 'Open a file',
    description: 'Ask Windows to open an existing file inside an approved directory with its default application.',
    risk: 'medium',
    confirmationRequired: true,
  },
  {
    id: 'files.reveal',
    label: 'Reveal a file in Explorer',
    description: 'Open Explorer with the exact approved file selected.',
    risk: 'low',
    confirmationRequired: true,
  },
  {
    id: 'system.info',
    label: 'Read system information',
    description: 'Return operating system, architecture, CPU, memory and uptime information. No commands are executed.',
    risk: 'low',
    confirmationRequired: false,
  },
];

export const DEFAULT_COMPUTER_OPERATIONS: Record<ComputerOperationId, ComputerOperationPolicy> =
  Object.fromEntries(
    COMPUTER_OPERATIONS.map((operation) => [
      operation.id,
      {
        enabled: operation.id !== 'files.create',
        requiresConfirmation: operation.confirmationRequired,
      },
    ]),
  ) as Record<ComputerOperationId, ComputerOperationPolicy>;
