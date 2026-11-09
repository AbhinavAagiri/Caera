import type {
  AgentPermissionRequirement,
  AgentRisk,
  AgentRun,
  AgentToolDescriptor,
  AgentToolSource,
  ComputerOperationId,
  ConnectorPermissionKind,
  ConnectorToolInputSchema,
} from '@shared';

export interface AgentToolContext {
  runId: string;
  stepId: string;
  signal: AbortSignal;
  confirmed: boolean;
}

export interface AgentToolResult {
  /** Short factual description of what the underlying operation returned. */
  summary: string;
  /** Structured data. The inspector bounds it before storage or model use. */
  data: unknown;
}

export interface AgentTool {
  name: string;
  label: string;
  description: string;
  source: AgentToolSource;
  sourceLabel: string;
  permission: AgentPermissionRequirement;
  risk: AgentRisk;
  requiresConfirmation: boolean;
  /** Live policy can require confirmation even when the static default is false. */
  confirmationRequired?: () => boolean;
  computerOperation?: ComputerOperationId;
  timeoutMs: number;
  inputSchema: ConnectorToolInputSchema;
  connectorId?: string;
  connectorPermission?: ConnectorPermissionKind;
  execute(args: Record<string, unknown>, context: AgentToolContext): Promise<AgentToolResult>;
}

export interface PendingAgentAction {
  requestId: string;
  stepId: string;
  toolRunId: string;
  toolName: string;
  toolLabel: string;
  permission: AgentPermissionRequirement;
  risk: AgentRisk;
  arguments: Record<string, unknown>;
  requestedAt: string;
  explanation: string;
}

/** Internal, persisted run shape. `pending` is never serialized directly. */
export interface StoredAgentRun {
  id: string;
  task: string;
  status: AgentRun['status'];
  steps: AgentRun['steps'];
  pending: PendingAgentAction | null;
  answer: string | null;
  error: AgentRun['error'];
  usage: AgentRun['usage'];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export function toAgentToolDescriptor(tool: AgentTool): AgentToolDescriptor {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    source: tool.source,
    sourceLabel: tool.sourceLabel,
    permission: tool.permission,
    risk: tool.risk,
    requiresConfirmation: tool.confirmationRequired?.() ?? tool.requiresConfirmation,
    timeoutMs: tool.timeoutMs,
    inputSchema: tool.inputSchema,
  };
}
