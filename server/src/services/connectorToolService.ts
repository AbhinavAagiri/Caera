import type {
  ConnectorCapability,
  ConnectorGrantSet,
  ConnectorOperationDefinition,
  ConnectorOperationResult,
  ConnectorPermissionKind,
  ConnectorToolDefinition,
  ConnectorToolInputSchema,
} from '@shared';
import { env } from '../config/env';
import {
  getConnectedApplication,
  getConnectedApplicationSecrets,
  listConnectedApplications,
  markConnectedApplicationUsed,
} from '../db/repositories/connectors';
import { recordToolExecution } from '../db/repositories/toolExecutions';
import { HttpError } from '../middleware/errors';
import { publish } from './eventBus';
import { logger } from './logger';
import { loadConnectorGrants } from '../connectors/grants';
import { getConnectorAdapter, listConnectorAdapters } from '../connectors/registry';

const RESULT_TYPE: Record<ConnectorCapability, ConnectorOperationResult['type']> = {
  search: 'search',
  read: 'read',
  create: 'write',
  append: 'write',
  update: 'write',
  delete: 'delete',
  open: 'open',
};

function inputSchema(operation: ConnectorOperationDefinition): ConnectorToolInputSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      operation.arguments.map((argument) => [
        argument.name,
        {
          type: argument.type,
          description: argument.description,
          ...(argument.maxLength !== undefined ? { maxLength: argument.maxLength } : {}),
          ...(argument.minimum !== undefined ? { minimum: argument.minimum } : {}),
          ...(argument.maximum !== undefined ? { maximum: argument.maximum } : {}),
          ...(argument.enum !== undefined ? { enum: argument.enum } : {}),
        },
      ]),
    ),
    required: operation.arguments
      .filter((argument) => argument.required)
      .map((argument) => argument.name),
  };
}

function toTool(
  connectorId: string,
  connectorName: string,
  operation: ConnectorOperationDefinition,
): ConnectorToolDefinition {
  return {
    id: `${connectorId}.${operation.id}`,
    connectorId,
    connectorName,
    operation: operation.id,
    capability: operation.capability,
    label: operation.label,
    description: operation.description,
    permission: operation.permission,
    destructive: operation.destructive,
    inputSchema: inputSchema(operation),
  };
}

/**
 * Only connected adapters expose tools. Planned integrations remain visible in
 * the catalog but contribute no executable surface.
 */
export function listConnectorTools(): ConnectorToolDefinition[] {
  const connected = new Set(
    listConnectedApplications()
      .filter((application) => application.status === 'connected')
      .map((application) => application.connector),
  );

  return listConnectorAdapters()
    .filter((adapter) => connected.has(adapter.descriptor.id))
    .flatMap((adapter) =>
      adapter.descriptor.operations.map((operation) =>
        toTool(adapter.descriptor.id, adapter.descriptor.name, operation),
      ),
    );
}

function requireTool(toolId: string): ConnectorToolDefinition {
  const tool = listConnectorTools().find((candidate) => candidate.id === toolId);
  if (!tool) {
    throw new HttpError(
      404,
      'CONNECTOR_TOOL_NOT_FOUND',
      'That connector tool is not registered or its application is not connected.',
    );
  }
  return tool;
}

/**
 * Validates raw model arguments against the registered schema. Unknown keys are
 * rejected rather than ignored, and the returned object contains only checked
 * primitive values.
 */
export function validateConnectorToolArguments(
  tool: ConnectorToolDefinition,
  raw: unknown,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `Arguments for ${tool.id} must be an object.`,
    );
  }

  const input = raw as Record<string, unknown>;
  const known = new Set(Object.keys(tool.inputSchema.properties));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        `Unknown argument "${key}" for ${tool.id}.`,
      );
    }
  }

  const validated: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(tool.inputSchema.properties)) {
    const value = input[name];
    if (value === undefined) {
      if (tool.inputSchema.required.includes(name)) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Argument "${name}" is required.`);
      }
      continue;
    }

    if (schema.type === 'string') {
      if (typeof value !== 'string') {
        throw new HttpError(400, 'VALIDATION_ERROR', `Argument "${name}" must be a string.`);
      }
      if (schema.enum !== undefined && !schema.enum.includes(value)) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          `Argument "${name}" must be one of the registered values.`,
        );
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          `Argument "${name}" must be ${schema.maxLength} characters or fewer.`,
        );
      }
      validated[name] = value;
      continue;
    }

    if (schema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Argument "${name}" must be an integer.`);
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Argument "${name}" is below its minimum.`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Argument "${name}" is above its maximum.`);
      }
      validated[name] = value;
      continue;
    }

    if (typeof value !== 'boolean') {
      throw new HttpError(400, 'VALIDATION_ERROR', `Argument "${name}" must be true or false.`);
    }
    validated[name] = value;
  }

  return validated;
}

function resultDetail(result: ConnectorOperationResult): string {
  switch (result.type) {
    case 'search':
      return `${result.notes.length} of ${result.total} matching notes returned`;
    case 'read':
      return result.note.truncated ? 'Read one note, truncated at the content cap' : 'Read one note';
    case 'write':
      return result.created ? 'Created a note' : 'Updated a note';
    case 'delete':
      return 'Deleted a note';
    case 'open':
      return 'Prepared a local Obsidian link';
  }
}

function safeError(cause: unknown): HttpError {
  if (cause instanceof HttpError) return cause;
  logger.error('connector_tool_failed', {
    name: cause instanceof Error ? cause.name : 'unknown',
  });
  return new HttpError(
    500,
    'CONNECTOR_OPERATION_FAILED',
    'The connector operation failed before it could complete.',
  );
}

export interface ExecuteConnectorToolOptions {
  confirmed?: boolean;
  conversationId?: string | null;
}

export async function executeConnectorTool(
  toolId: string,
  rawArguments: unknown,
  options: ExecuteConnectorToolOptions = {},
): Promise<ConnectorOperationResult> {
  if (!env.connectors.enabled) {
    throw new HttpError(
      409,
      'CONNECTOR_DISABLED',
      'Connector operations are disabled on this local node.',
    );
  }

  const tool = requireTool(toolId);
  const application = getConnectedApplication(tool.connectorId);
  if (!application || application.status !== 'connected') {
    throw new HttpError(
      409,
      'CONNECTOR_NOT_CONNECTED',
      `${tool.connectorName} is not connected.`,
    );
  }

  const adapter = getConnectorAdapter(tool.connectorId);
  if (!adapter) {
    throw new HttpError(
      404,
      'CONNECTOR_TOOL_NOT_FOUND',
      'The registered adapter for that connector is unavailable.',
    );
  }

  const startedAt = new Date().toISOString();
  const grants: ConnectorGrantSet = loadConnectorGrants(tool.connectorId);
  const permissionLabel = tool.permission;
  const runtime = {
    config: application.config,
    secrets: getConnectedApplicationSecrets(tool.connectorId),
  };

  try {
    if (!grants[tool.permission as ConnectorPermissionKind]) {
      throw new HttpError(
        403,
        'CONNECTOR_PERMISSION_DENIED',
        `${tool.connectorName} has not granted ${permissionLabel} permission.`,
        'Open Connections and grant this permission deliberately before retrying.',
      );
    }

    const requiresConfirmation = adapter.requiresConfirmation
      ? adapter.requiresConfirmation(tool.operation, runtime)
      : tool.destructive;
    if (requiresConfirmation && options.confirmed !== true) {
      throw new HttpError(
        409,
        'CONNECTOR_CONFIRMATION_REQUIRED',
        tool.destructive
          ? `${tool.label} is destructive and needs explicit confirmation.`
          : `${tool.label} needs explicit confirmation.`,
        tool.destructive
          ? 'This confirmation is separate from the connector permission.'
          : 'Review the intended path and content, then confirm the write.',
      );
    }

    const args = validateConnectorToolArguments(tool, rawArguments);

    const result = await adapter.execute(tool.operation, args, runtime);
    if (result.type !== RESULT_TYPE[tool.capability]) {
      throw new HttpError(
        500,
        'CONNECTOR_OPERATION_FAILED',
        'The connector returned an unexpected result shape.',
      );
    }

    const finishedAt = new Date().toISOString();
    const summary = `${tool.connectorName}: ${tool.label}`;
    const detail = resultDetail(result);

    // The adapter already completed a real operation. An audit or event
    // failure must not turn that success into a reported tool failure.
    try {
      recordToolExecution({
        toolId: tool.id,
        conversationId: options.conversationId ?? null,
        status: 'completed',
        summary,
        startedAt,
        finishedAt,
      });
      markConnectedApplicationUsed(tool.connectorId, finishedAt);
      publish({
        kind: 'tool',
        status: 'completed',
        summary,
        detail,
        meta: {
          connector: tool.connectorId,
          operation: tool.operation,
          permission: tool.permission,
        },
      });
    } catch {
      logger.error('connector_tool_audit_failed', { toolId: tool.id });
    }

    return result;
  } catch (cause) {
    const error = safeError(cause);
    const finishedAt = new Date().toISOString();

    try {
      recordToolExecution({
        toolId: tool.id,
        conversationId: options.conversationId ?? null,
        status: 'failed',
        summary: `${tool.connectorName}: ${tool.label} failed`,
        startedAt,
        finishedAt,
        errorCode: error.code,
      });
      publish({
        kind: 'tool',
        status: 'failed',
        summary: `${tool.connectorName}: ${tool.label} failed`,
        detail: error.message,
        meta: {
          connector: tool.connectorId,
          operation: tool.operation,
          permission: tool.permission,
        },
      });
    } catch {
      logger.error('connector_tool_failure_audit_failed', { toolId: tool.id });
    }

    throw error;
  }
}
