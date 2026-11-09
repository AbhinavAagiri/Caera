import type { ApiErrorBody } from './api.js';
import type { ConnectorToolInputSchema } from './connectors.js';
import type { IsoTimestamp } from './conversations.js';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentStepStatus =
  | 'pending'
  | 'running'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'skipped';

export type AgentToolRunStatus =
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'denied';

export type AgentToolSource = 'connector' | 'computer' | 'knowledge' | 'web' | 'calculation' | 'local';
export type AgentPermissionRequirement = 'read' | 'write' | 'delete' | 'network' | 'local';
export type AgentRisk = 'low' | 'medium' | 'high';

/**
 * A model-safe descriptor. Execution code resolves tools by this exact name;
 * a plan or model response cannot invent an operation.
 */
export interface AgentToolDescriptor {
  name: string;
  label: string;
  description: string;
  source: AgentToolSource;
  sourceLabel: string;
  permission: AgentPermissionRequirement;
  risk: AgentRisk;
  /** Consequential tools pause before execution, separate from permission. */
  requiresConfirmation: boolean;
  timeoutMs: number;
  inputSchema: ConnectorToolInputSchema;
}

export interface AgentToolCatalog {
  tools: AgentToolDescriptor[];
  updatedAt: IsoTimestamp;
}

export interface AgentToolRun {
  id: string;
  toolName: string;
  toolLabel: string;
  /** Validated input shown to the user when confirmation is required. */
  arguments: Record<string, unknown>;
  status: AgentToolRunStatus;
  summary: string | null;
  /** Bounded, inspected result of the underlying operation. */
  resultPreview: string | null;
  error: string | null;
  startedAt: IsoTimestamp | null;
  finishedAt: IsoTimestamp | null;
}

export interface AgentRunStep {
  id: string;
  position: number;
  title: string;
  objective: string;
  status: AgentStepStatus;
  toolRuns: AgentToolRun[];
  summary: string | null;
  error: string | null;
  startedAt: IsoTimestamp | null;
  finishedAt: IsoTimestamp | null;
}

export interface AgentConfirmation {
  requestId: string;
  toolName: string;
  toolLabel: string;
  permission: AgentPermissionRequirement;
  risk: AgentRisk;
  /** The exact validated action that will run if approved. */
  arguments: Record<string, unknown>;
  requestedAt: IsoTimestamp;
  explanation: string;
}

export interface AgentRunLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxRunMs: number;
  toolTimeoutMs: number;
}

export interface AgentRunUsage {
  toolCalls: number;
  elapsedMs: number;
}

export interface AgentRun {
  id: string;
  task: string;
  status: AgentRunStatus;
  steps: AgentRunStep[];
  confirmation: AgentConfirmation | null;
  answer: string | null;
  error: ApiErrorBody | null;
  usage: AgentRunUsage;
  limits: AgentRunLimits;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  finishedAt: IsoTimestamp | null;
}

export interface AgentRunList {
  runs: AgentRun[];
}

export interface AgentStartInput {
  task: string;
}

export interface AgentDecisionInput {
  approve: boolean;
}

export interface AgentToolExecutionView {
  status: 'completed' | 'failed';
  summary: string;
  preview: string;
  tool: string;
}
