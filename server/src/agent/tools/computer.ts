import type { AgentTool } from '../types';
import {
  computerOperationRequiresConfirmation,
  executeComputerOperation,
  getComputerSnapshot,
} from '../../services/computerService';

function tool(
  name: string,
  label: string,
  description: string,
  operation: AgentTool['computerOperation'],
  permission: AgentTool['permission'],
  risk: AgentTool['risk'],
  timeoutMs: number,
  properties: AgentTool['inputSchema']['properties'],
  required: string[],
): AgentTool {
  if (!operation) throw new Error('Computer tool has no operation.');
  return {
    name,
    label,
    description,
    source: 'computer',
    sourceLabel: 'Local computer',
    permission,
    risk,
    // The effective value is computed lazily after the database is open.
    requiresConfirmation: false,
    confirmationRequired: () => computerOperationRequiresConfirmation(operation),
    computerOperation: operation,
    timeoutMs,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties,
      required,
    },
    async execute(args, context) {
      const result = await executeComputerOperation(operation, args, {
        confirmed: context.confirmed,
        signal: context.signal,
      });
      return { summary: result.summary, data: result.data };
    },
  };
}

const ALL: AgentTool[] = [
  tool(
    'computer.open_application',
    'Open an approved application',
    'Launch one executable explicitly approved on the Tools page. It accepts an application id, never a command or arguments.',
    'applications.open',
    'local',
    'medium',
    10_000,
    { applicationId: { type: 'string', description: 'Approved application id.', maxLength: 80 } },
    ['applicationId'],
  ),
  tool(
    'computer.open_website',
    'Open a website',
    'Hand one http(s) URL to the default browser. Embedded credentials and non-web protocols are rejected.',
    'websites.open',
    'network',
    'medium',
    5_000,
    { url: { type: 'string', description: 'Public http or https URL.', maxLength: 2048 } },
    ['url'],
  ),
  tool(
    'computer.search_files',
    'Search approved folders',
    'Search file names and relative paths inside one read-approved directory. Symlinks and paths outside it are skipped.',
    'files.search',
    'read',
    'low',
    10_000,
    {
      directoryId: { type: 'string', description: 'Approved directory id.', maxLength: 80 },
      query: { type: 'string', description: 'Text to find in file names or relative paths.', maxLength: 100 },
      limit: { type: 'integer', description: 'Maximum results, 1 to 50.', minimum: 1, maximum: 50 },
    },
    ['directoryId', 'query'],
  ),
  tool(
    'computer.read_file',
    'Read an approved text file',
    'Read a bounded UTF-8 file inside a read-approved directory. Binary and oversized files are rejected.',
    'files.read',
    'read',
    'low',
    5_000,
    {
      directoryId: { type: 'string', description: 'Approved directory id.', maxLength: 80 },
      relativePath: { type: 'string', description: 'File path relative to the approved directory.', maxLength: 500 },
    },
    ['directoryId', 'relativePath'],
  ),
  tool(
    'computer.create_file',
    'Create a file in an approved directory',
    'Create one new text file inside a directory approved for creation. It never overwrites an existing file.',
    'files.create',
    'write',
    'medium',
    5_000,
    {
      directoryId: { type: 'string', description: 'Directory approved for creation.', maxLength: 80 },
      relativePath: { type: 'string', description: 'New file path relative to the approved directory.', maxLength: 500 },
      content: { type: 'string', description: 'UTF-8 file content; existing files are never overwritten.', maxLength: 100000 },
    },
    ['directoryId', 'relativePath', 'content'],
  ),
  tool(
    'computer.open_file',
    'Open a file with its default application',
    'Ask Windows to open an existing file inside a read-approved directory.',
    'files.open',
    'local',
    'medium',
    5_000,
    {
      directoryId: { type: 'string', description: 'Approved directory id.', maxLength: 80 },
      relativePath: { type: 'string', description: 'Existing file path relative to the approved directory.', maxLength: 500 },
    },
    ['directoryId', 'relativePath'],
  ),
  tool(
    'computer.reveal_file',
    'Reveal a file in Explorer',
    'Open Explorer with an existing approved file selected.',
    'files.reveal',
    'local',
    'low',
    5_000,
    {
      directoryId: { type: 'string', description: 'Approved directory id.', maxLength: 80 },
      relativePath: { type: 'string', description: 'Existing file path relative to the approved directory.', maxLength: 500 },
    },
    ['directoryId', 'relativePath'],
  ),
  tool(
    'computer.system_info',
    'Read system information',
    'Return operating system, CPU, memory, uptime and architecture information without running a command.',
    'system.info',
    'local',
    'low',
    2_000,
    {},
    [],
  ),
];

/** Only enabled operations are offered to the model. */
export function listComputerAgentTools(): AgentTool[] {
  const settings = getComputerSnapshot().settings;
  if (!settings.enabled) return [];
  return ALL.filter((entry) => {
    const operation = entry.computerOperation;
    return operation ? settings.operations[operation]?.enabled === true : false;
  });
}
