import type { AiTaskCategory } from '@shared';
import { runCompletion } from '../ai/generation';
import { RouteError } from '../ai/router';
import { ProviderError } from '../providers/errors';
import { AgentError, toAgentError } from './errorHandling';

interface AgentModelOptions {
  system: string;
  prompt: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputTokens: number;
  category?: AiTaskCategory;
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] ?? trimmed;
  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    throw new AgentError(
      'AGENT_INVALID_MODEL_OUTPUT',
      'The model returned a response the agent could not validate.',
      {
        status: 502,
        hint: 'The run stopped without executing an unvalidated action. Try the task again.',
      },
    );
  }
}

function mapRouteFailure(error: RouteError): never {
  if (error.code === 'AI_MODEL_UNAVAILABLE' || error.code === 'AI_NO_SUITABLE_MODEL') {
    throw new AgentError(
      'AGENT_PROVIDER_NOT_CONFIGURED',
      'No configured AI model is available to plan this task.',
      {
        status: 409,
        hint: 'Connect a provider in Settings → Models & usage, then start the task again.',
      },
    );
  }

  throw new AgentError('AGENT_MODEL_FAILED', error.message, {
    status: error.code === 'AI_BUDGET_EXCEEDED' ? 409 : 502,
    ...(error.hint ? { hint: error.hint } : {}),
  });
}

function mapModelFailure(cause: unknown): never {
  if (cause instanceof AgentError) throw cause;
  if (cause instanceof RouteError) mapRouteFailure(cause);
  if (cause instanceof ProviderError) {
    if (cause.code === 'PROVIDER_NOT_CONFIGURED') {
      throw new AgentError(
        'AGENT_PROVIDER_NOT_CONFIGURED',
        'No configured AI model is available to plan this task.',
        {
          status: 409,
          hint: 'Connect a provider in Settings → Models & usage, then start the task again.',
        },
      );
    }
  }
  throw toAgentError(cause);
}

async function generate(
  options: AgentModelOptions,
  responseFormat: 'json' | 'text',
  schema?: unknown,
): Promise<string> {
  const local = new AbortController();
  const onParentAbort = (): void => local.abort();
  if (options.signal.aborted) local.abort();
  else options.signal.addEventListener('abort', onParentAbort, { once: true });

  const timer = setTimeout(() => local.abort(), Math.max(1_000, options.timeoutMs));
  timer.unref();

  const system = [
    options.system,
    responseFormat === 'json' ? 'Return only valid JSON. Do not wrap it in prose.' : '',
    responseFormat === 'json' && schema ? `JSON schema:\n${JSON.stringify(schema)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const result = await runCompletion({
      conversationId: null,
      routingContent: options.prompt,
      messages: [{ role: 'user', content: options.prompt }],
      systemInstruction: system,
      signal: local.signal,
      timeoutMs: options.timeoutMs,
      maxOutputTokens: options.maxOutputTokens,
      ...(responseFormat === 'json'
        ? {
            responseMimeType: 'application/json' as const,
            ...(schema !== undefined ? { responseJsonSchema: schema } : {}),
          }
        : {}),
      onText: () => undefined,
    });

    const text = result.text.trim();
    if (!text) {
      throw new AgentError(
        'AGENT_INVALID_MODEL_OUTPUT',
        'The model returned no usable text for this agent stage.',
        {
          status: 502,
          hint: 'The run stopped without executing any new action. Try again.',
        },
      );
    }
    return text;
  } catch (cause) {
    if (options.signal.aborted) {
      throw new AgentError('AGENT_CANCELLED', 'The agent task was cancelled.', { status: 409 });
    }
    if (local.signal.aborted) {
      throw new AgentError(
        'AGENT_MODEL_FAILED',
        'The AI provider did not answer before the agent model timeout.',
        {
          status: 504,
          hint: 'No tool was executed from that model call. Try the task again.',
        },
      );
    }
    mapModelFailure(cause);
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onParentAbort);
  }
}

export async function generateAgentJson(
  options: AgentModelOptions & { schema: unknown },
): Promise<unknown> {
  const text = await generate(options, 'json', options.schema);
  return parseJsonResponse(text);
}

export async function generateAgentText(options: AgentModelOptions): Promise<string> {
  return generate(options, 'text');
}
