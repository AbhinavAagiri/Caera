import type {
  AgentRun,
  AgentRunList,
  AgentToolCatalog,
  AiProviderId,
  AiRouteRequest,
  AiSettingsInput,
  AiSnapshot,
  RoutePreview,
  ProviderCredentialInput,
  UsageMode,
  ApiErrorBody,
  ApiResponse,
  ComputerActionPlan,
  ComputerOperationId,
  ComputerOperationResult,
  ComputerSettingsInput,
  ComputerSnapshot,
  ConnectorDirectoryListing,
  ConnectorDraftInput,
  ConnectorDraftPreview,
  ConnectorOperationResult,
  ConnectorPermissionInput,
  ConnectorSnapshot,
  ConnectorTestResult,
  ConversationListResponse,
  ConversationResponse,
  CreateConversationInput,
  HealthReport,
  KnowledgeClearResult,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  KnowledgeSettingsInput,
  KnowledgeSnapshot,
  KnowledgeSyncResult,
  MemoryEntry,
  MemoryEntryInput,
  MemoryKind,
  MemoryListResult,
  MemorySettingsResult,
  MemoryUpdateInput,
  PermissionLevel,
  PermissionSnapshot,
  ProviderConfigInput,
  ProviderSettingsResult,
  ProviderStatus,
  ToolId,
  TurnStreamEvent,
  VoiceConfigInput,
  VoiceSettingsResult,
  VoiceSpeechInput,
  VoiceTestInput,
  VoiceTranscriptionResult,
} from '@shared';

const BASE = '/api';

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly hint?: string;

  constructor(message: string, options: { code: string; status: number; hint?: string }) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = options.code;
    this.status = options.status;
    if (options.hint) this.hint = options.hint;
  }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

export function toApiError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  if (error instanceof Error) {
    return new ApiRequestError(error.message, { code: 'UNKNOWN', status: 0 });
  }
  return new ApiRequestError('Something went wrong in the browser.', { code: 'UNKNOWN', status: 0 });
}

export interface VoiceAudioResponse {
  blob: Blob;
  contentType: string;
  voiceId: string | null;
  format: string | null;
  truncated: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiRequestError('The local node is not responding.', {
      code: 'NODE_UNREACHABLE',
      status: 0,
      hint: 'Start it with npm run dev, then retry.',
    });
  }

  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    payload = null;
  }

  if (!payload) {
    throw new ApiRequestError('The local node returned an unreadable response.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }

  if (!payload.ok) {
    const error: ApiErrorBody = payload.error;
    throw new ApiRequestError(error.message, {
      code: error.code,
      status: response.status,
      ...(error.hint ? { hint: error.hint } : {}),
    });
  }

  return payload.data;
}

async function requestAudio(path: string, init?: RequestInit): Promise<VoiceAudioResponse> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiRequestError('The local node is not responding.', {
      code: 'NODE_UNREACHABLE',
      status: 0,
      hint: 'Start it with npm run dev, then retry.',
    });
  }

  if (!response.ok) {
    let payload: ApiResponse<unknown> | null = null;
    try {
      payload = (await response.json()) as ApiResponse<unknown>;
    } catch {
      payload = null;
    }

    if (payload && !payload.ok) {
      throw new ApiRequestError(payload.error.message, {
        code: payload.error.code,
        status: response.status,
        ...(payload.error.hint ? { hint: payload.error.hint } : {}),
      });
    }

    throw new ApiRequestError('VoiceStudio could not generate audio.', {
      code: 'VOICE_ERROR',
      status: response.status,
      hint: 'Check Settings → Voice for the current VoiceStudio state.',
    });
  }

  const contentType = (response.headers.get('content-type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase() ?? '';
  if (!contentType.startsWith('audio/')) {
    throw new ApiRequestError('The voice response was not audio.', {
      code: 'VOICE_ERROR',
      status: response.status,
    });
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw new ApiRequestError('VoiceStudio returned an empty audio file.', {
      code: 'VOICE_ERROR',
      status: response.status,
    });
  }

  return {
    blob,
    contentType,
    voiceId: response.headers.get('x-caera-voice-id'),
    format: response.headers.get('x-caera-voice-format'),
    truncated: response.headers.get('x-caera-voice-truncated') === 'true',
  };
}

function parseSseFrame(frame: string, onEvent: (event: TurnStreamEvent) => void): void {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (!data) return;

  try {
    const event = JSON.parse(data) as TurnStreamEvent;
    if (event && typeof event.type === 'string') onEvent(event);
  } catch {
    // A malformed frame is ignored; the next frame can still complete the turn.
  }
}

async function streamTurn(
  id: string,
  content: string,
  options: {
    signal?: AbortSignal;
    onEvent: (event: TurnStreamEvent) => void;
    model?: string | null;
    mode?: UsageMode;
  },
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`${BASE}/conversations/${encodeURIComponent(id)}/turns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        content,
        ...(options.model ? { model: options.model } : {}),
        ...(options.mode ? { mode: options.mode } : {}),
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiRequestError('The local node is not responding.', {
      code: 'NODE_UNREACHABLE',
      status: 0,
      hint: 'Start it with npm run dev, then retry.',
    });
  }

  if (!response.ok) {
    let payload: ApiResponse<unknown> | null = null;
    try {
      payload = (await response.json()) as ApiResponse<unknown>;
    } catch {
      payload = null;
    }

    if (payload && !payload.ok) {
      throw new ApiRequestError(payload.error.message, {
        code: payload.error.code,
        status: response.status,
        ...(payload.error.hint ? { hint: payload.error.hint } : {}),
      });
    }

    throw new ApiRequestError('The local node rejected the reply request.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }

  if (!response.body) {
    throw new ApiRequestError('The reply stream did not open.', {
      code: 'STREAM_INTERRUPTED',
      status: response.status,
      hint: 'Retry the message.',
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');

      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        parseSseFrame(frame, options.onEvent);
        boundary = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) parseSseFrame(buffer, options.onEvent);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiRequestError('The reply stream was interrupted.', {
      code: 'STREAM_INTERRUPTED',
      status: 0,
      hint: 'The local node may have saved a partial reply. Reload the thread.',
    });
  } finally {
    reader.releaseLock();
  }
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthReport>('/health', { signal }),

  providerCheck: (signal?: AbortSignal) =>
    request<{ provider: ProviderStatus }>('/provider/check', { method: 'POST', signal }),

  providerConfig: (signal?: AbortSignal) =>
    request<ProviderSettingsResult>('/provider/config', { signal }),

  updateProviderConfig: (input: ProviderConfigInput) =>
    request<ProviderSettingsResult>('/provider/config', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  removeProviderKey: () =>
    request<ProviderSettingsResult>('/provider/key', { method: 'DELETE' }),

  aiSnapshot: (signal?: AbortSignal) => request<AiSnapshot>('/ai', { signal }),

  updateAiSettings: (input: AiSettingsInput) =>
    request<{ settings: AiSnapshot['settings']; snapshot: AiSnapshot }>('/ai/settings', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  saveAiProvider: (id: AiProviderId, input: ProviderCredentialInput) =>
    request<AiSnapshot>(`/ai/providers/${encodeURIComponent(id)}/credential`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  removeAiProvider: (id: AiProviderId) =>
    request<AiSnapshot>(`/ai/providers/${encodeURIComponent(id)}/credential`, {
      method: 'DELETE',
    }),

  testAiProvider: (id: AiProviderId) =>
    request<{ provider: AiSnapshot['providers'][number]; snapshot: AiSnapshot }>(
      `/ai/providers/${encodeURIComponent(id)}/test`,
      { method: 'POST' },
    ),

  previewAiRoute: (input: AiRouteRequest) =>
    request<RoutePreview>('/ai/route/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listConversations: (query?: string, signal?: AbortSignal) =>
    request<ConversationListResponse>(
      `/conversations${query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
      { signal },
    ),

  getConversation: (id: string, signal?: AbortSignal) =>
    request<ConversationResponse>(`/conversations/${encodeURIComponent(id)}`, { signal }),

  createConversation: (input: CreateConversationInput, signal?: AbortSignal) =>
    request<ConversationResponse>('/conversations', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    }),

  appendMessage: (id: string, content: string, signal?: AbortSignal) =>
    request<ConversationResponse>(`/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
      signal,
    }),

  streamTurn,

  renameConversation: (id: string, title: string) =>
    request<ConversationResponse>(`/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  deleteConversation: (id: string) =>
    request<{ deleted: boolean }>(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  clearConversations: () => request<{ deleted: number }>('/conversations', { method: 'DELETE' }),

  listMemory: (
    options: { query?: string; kind?: MemoryKind } = {},
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (options.query?.trim()) params.set('q', options.query.trim());
    if (options.kind) params.set('kind', options.kind);
    const query = params.toString();
    return request<MemoryListResult>(`/memory${query ? `?${query}` : ''}`, { signal });
  },

  memorySettings: (signal?: AbortSignal) =>
    request<MemorySettingsResult>('/memory/settings', { signal }),

  updateMemorySettings: (paused: boolean) =>
    request<MemorySettingsResult>('/memory/settings', {
      method: 'PUT',
      body: JSON.stringify({ paused }),
    }),

  createMemory: (input: MemoryEntryInput) =>
    request<{ entry: MemoryEntry }>('/memory', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateMemory: (id: string, input: MemoryUpdateInput) =>
    request<{ entry: MemoryEntry }>(`/memory/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteMemory: (id: string) =>
    request<{ deleted: boolean }>(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  clearMemories: () => request<{ deleted: number }>('/memory', { method: 'DELETE' }),

  voiceSettings: (signal?: AbortSignal) => request<VoiceSettingsResult>('/voice/config', { signal }),

  updateVoiceSettings: (input: VoiceConfigInput) =>
    request<VoiceSettingsResult>('/voice/config', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  checkVoice: () => request<VoiceSettingsResult>('/voice/check', { method: 'POST' }),

  startVoiceService: () =>
    request<VoiceSettingsResult>('/voice/service/start', { method: 'POST' }),

  stopVoiceService: () =>
    request<VoiceSettingsResult>('/voice/service/stop', { method: 'POST' }),

  testVoice: (input: VoiceTestInput, signal?: AbortSignal) =>
    requestAudio('/voice/test', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    }),

  speakMessage: (input: VoiceSpeechInput, signal?: AbortSignal) =>
    requestAudio('/voice/speech', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    }),

  /** Sends push-to-talk WAV to the local node, which forwards it to VoiceStudio. */
  transcribeVoice: (audio: Blob, signal?: AbortSignal) =>
    request<VoiceTranscriptionResult>('/voice/transcribe', {
      method: 'POST',
      body: audio,
      headers: { 'Content-Type': audio.type || 'audio/wav' },
      signal,
    }),

  agentTools: (signal?: AbortSignal) =>
    request<AgentToolCatalog>('/agent/tools', { signal }),

  listAgentRuns: (signal?: AbortSignal) =>
    request<AgentRunList>('/agent/runs', { signal }),

  startAgentRun: (task: string) =>
    request<{ run: AgentRun }>('/agent/runs', {
      method: 'POST',
      body: JSON.stringify({ task }),
    }),

  getAgentRun: (id: string, signal?: AbortSignal) =>
    request<{ run: AgentRun }>(`/agent/runs/${encodeURIComponent(id)}`, { signal }),

  decideAgentRun: (id: string, approve: boolean) =>
    request<{ run: AgentRun }>(`/agent/runs/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ approve }),
    }),

  cancelAgentRun: (id: string) =>
    request<{ run: AgentRun }>(`/agent/runs/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }),

  knowledge: (signal?: AbortSignal) => request<KnowledgeSnapshot>('/knowledge', { signal }),

  updateKnowledgeSettings: (input: KnowledgeSettingsInput) =>
    request<KnowledgeSnapshot>('/knowledge/settings', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  syncKnowledge: (sources?: string[]) =>
    request<KnowledgeSyncResult>('/knowledge/sync', {
      method: 'POST',
      body: JSON.stringify(sources?.length ? { sources } : {}),
    }),

  searchKnowledge: (input: KnowledgeSearchInput) =>
    request<KnowledgeSearchResult>('/knowledge/search', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  clearKnowledge: (source?: string) =>
    request<KnowledgeClearResult>('/knowledge', {
      method: 'DELETE',
      body: JSON.stringify(source ? { source } : {}),
    }),

  connectors: (signal?: AbortSignal) => request<ConnectorSnapshot>('/connectors', { signal }),

  connectorDirectories: (id: string, path?: string, signal?: AbortSignal) =>
    request<ConnectorDirectoryListing>(
      `/connectors/${encodeURIComponent(id)}/directories${
        path ? `?path=${encodeURIComponent(path)}` : ''
      }`,
      { signal },
    ),

  previewConnectorDraft: (id: string, input: ConnectorDraftInput) =>
    request<{ preview: ConnectorDraftPreview }>(
      `/connectors/${encodeURIComponent(id)}/draft`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  executeConnectorTool: (
    toolId: string,
    args: Record<string, unknown>,
    confirmed = false,
  ) =>
    request<{ result: ConnectorOperationResult }>(
      `/connectors/tools/${encodeURIComponent(toolId)}/execute`,
      {
        method: 'POST',
        body: JSON.stringify({ arguments: args, confirmed }),
      },
    ),

  connectConnector: (id: string, configuration: Record<string, string>) =>
    request<ConnectorSnapshot>(`/connectors/${encodeURIComponent(id)}/connect`, {
      method: 'POST',
      body: JSON.stringify({ configuration }),
    }),

  testConnector: (id: string) =>
    request<ConnectorTestResult>(`/connectors/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    }),

  updateConnectorPermissions: (id: string, input: ConnectorPermissionInput) =>
    request<ConnectorSnapshot>(`/connectors/${encodeURIComponent(id)}/permissions`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  disconnectConnector: (id: string) =>
    request<ConnectorSnapshot>(`/connectors/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  computer: (signal?: AbortSignal) => request<ComputerSnapshot>('/computer', { signal }),

  updateComputerSettings: (input: ComputerSettingsInput) =>
    request<ComputerSnapshot>('/computer/settings', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  previewComputerOperation: (operation: ComputerOperationId, args: Record<string, unknown>) =>
    request<ComputerActionPlan>('/computer/operations/preview', {
      method: 'POST',
      body: JSON.stringify({ operation, arguments: args }),
    }),

  executeComputerOperation: (
    operation: ComputerOperationId,
    args: Record<string, unknown>,
    confirmed = false,
  ) =>
    request<ComputerOperationResult>('/computer/operations', {
      method: 'POST',
      body: JSON.stringify({ operation, arguments: args, confirmed }),
    }),

  permissions: (signal?: AbortSignal) => request<PermissionSnapshot>('/permissions', { signal }),

  setPermission: (toolId: ToolId, level: PermissionLevel) =>
    request<PermissionSnapshot>(`/permissions/${encodeURIComponent(toolId)}`, {
      method: 'PUT',
      body: JSON.stringify({ level }),
    }),
};
