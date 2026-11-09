import type { ApiErrorBody } from '@shared';
import { ProviderError } from '../providers/errors';
import { HttpError } from '../middleware/errors';
import { logger } from '../services/logger';

export type AgentErrorCode =
  | 'AGENT_PROVIDER_NOT_CONFIGURED'
  | 'AGENT_MODEL_FAILED'
  | 'AGENT_INVALID_MODEL_OUTPUT'
  | 'AGENT_TOOL_NOT_FOUND'
  | 'AGENT_TOOL_ARGUMENTS_INVALID'
  | 'AGENT_TOOL_CONFIRMATION_REQUIRED'
  | 'AGENT_PERMISSION_DENIED'
  | 'AGENT_TOOL_TIMEOUT'
  | 'AGENT_TOOL_FAILED'
  | 'AGENT_TIME_LIMIT'
  | 'AGENT_TOOL_LIMIT'
  | 'AGENT_STEP_LIMIT'
  | 'AGENT_BLOCKED'
  | 'AGENT_CANCELLED'
  | 'AGENT_RUN_NOT_FOUND'
  | 'AGENT_RUN_CONFLICT'
  | 'AGENT_WEB_BLOCKED'
  | 'AGENT_INTERRUPTED'
  | 'AGENT_INTERNAL_ERROR';

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly status: number;
  readonly hint?: string;

  constructor(code: AgentErrorCode, message: string, options: { status?: number; hint?: string } = {}) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.status = options.status ?? 400;
    if (options.hint) this.hint = options.hint;
  }

  toApiErrorBody(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
    };
  }
}

export function toAgentError(cause: unknown): AgentError {
  if (cause instanceof AgentError) return cause;

  if (cause instanceof ProviderError) {
    if (cause.code === 'PROVIDER_NOT_CONFIGURED') {
      return new AgentError(
        'AGENT_PROVIDER_NOT_CONFIGURED',
        'No configured AI model is available, so the agent cannot understand or plan this task.',
        {
          status: 409,
          hint: 'Connect a provider in Settings → Models & usage, then start the task again.',
        },
      );
    }
    return new AgentError('AGENT_MODEL_FAILED', cause.message, {
      status: 502,
      ...(cause.hint ? { hint: cause.hint } : {}),
    });
  }

  if (cause instanceof HttpError) {
    if (cause.code === 'CONNECTOR_PERMISSION_DENIED') {
      return new AgentError('AGENT_PERMISSION_DENIED', cause.message, {
        status: 403,
        ...(cause.hint ? { hint: cause.hint } : {}),
      });
    }
    if (cause.code === 'CONNECTOR_CONFIRMATION_REQUIRED' || cause.code === 'CONNECTOR_WRITE_CONFIRMATION_REQUIRED') {
      return new AgentError('AGENT_TOOL_CONFIRMATION_REQUIRED', cause.message, {
        status: 409,
        ...(cause.hint ? { hint: cause.hint } : {}),
      });
    }
    return new AgentError('AGENT_TOOL_FAILED', cause.message, {
      status: cause.status >= 500 ? 502 : cause.status,
      ...(cause.hint ? { hint: cause.hint } : {}),
    });
  }

  if (cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
    return new AgentError('AGENT_TOOL_TIMEOUT', 'The operation exceeded its local time limit.', {
      status: 504,
      hint: 'No success was recorded. Retry with a smaller request or check the application.',
    });
  }

  logger.error('agent_unhandled_error', {
    name: cause instanceof Error ? cause.name : 'unknown',
  });
  return new AgentError(
    'AGENT_INTERNAL_ERROR',
    'The agent runtime failed before it could complete this step.',
    {
      status: 500,
      hint: 'Check the local node terminal. Completed tools remain recorded in the run.',
    },
  );
}

export function safeAgentError(cause: unknown): ApiErrorBody {
  return toAgentError(cause).toApiErrorBody();
}

export function assertWithinTimeLimit(deadline: number): void {
  if (Date.now() >= deadline) {
    throw new AgentError(
      'AGENT_TIME_LIMIT',
      'The agent reached its execution time limit before completing the task.',
      {
        status: 408,
        hint: 'Completed steps are kept. Start a narrower task or raise the limits in a future build.',
      },
    );
  }
}

/**
 * Tool-level timeout. It aborts the signal the tool receives and rejects with
 * a stable error; it never turns an unconfirmed or failed action into success.
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref();
  const onParentAbort = (): void => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => {
            reject(
              timedOut
                ? new AgentError(
                    'AGENT_TOOL_TIMEOUT',
                    `${label} exceeded its ${Math.round(timeoutMs / 1_000)} second limit.`,
                    {
                      status: 504,
                      hint: 'The operation was stopped. Nothing is reported as successful.',
                    },
                  )
                : new AgentError('AGENT_CANCELLED', 'The agent task was cancelled.', {
                    status: 409,
                  }),
            );
          },
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}
