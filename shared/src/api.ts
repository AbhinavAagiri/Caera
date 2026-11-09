/**
 * Wire contract between the CAERA client and the local Express node.
 * Every response uses the same envelope so the client has one failure path.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  hint?: string;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };

export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN_ORIGIN'
  | 'REQUEST_TIMEOUT'
  | 'PAYLOAD_TOO_LARGE'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_AUTH_ERROR'
  | 'PROVIDER_CONFIG_ERROR'
  | 'PROVIDER_MODEL_NOT_FOUND'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_UNREACHABLE'
  | 'PROVIDER_BLOCKED'
  | 'PROVIDER_ERROR'
  | 'AI_MODEL_UNAVAILABLE'
  | 'AI_NO_SUITABLE_MODEL'
  | 'AI_BUDGET_EXCEEDED'
  | 'AI_SPENDING_CONFIRMATION_REQUIRED'
  | 'GENERATION_CANCELLED'
  | 'STREAM_INTERRUPTED'
  | 'VOICE_DISABLED'
  | 'VOICE_UNAVAILABLE'
  | 'VOICE_UNSUPPORTED'
  | 'VOICE_TIMEOUT'
  | 'VOICE_ERROR'
  | 'MEMORY_PAUSED'
  | 'CONNECTOR_DISABLED'
  | 'CONNECTOR_NOT_FOUND'
  | 'CONNECTOR_NOT_AVAILABLE'
  | 'CONNECTOR_NOT_CONNECTED'
  | 'CONNECTOR_CONFIG_INVALID'
  | 'CONNECTOR_PERMISSION_DENIED'
  | 'CONNECTOR_CONFIRMATION_REQUIRED'
  | 'CONNECTOR_WRITE_CONFIRMATION_REQUIRED'
  | 'CONNECTOR_TOOL_NOT_FOUND'
  | 'CONNECTOR_OPERATION_FAILED'
  | 'KNOWLEDGE_DISABLED'
  | 'KNOWLEDGE_SOURCE_NOT_FOUND'
  | 'KNOWLEDGE_SOURCE_DISABLED'
  | 'KNOWLEDGE_NOT_READY'
  | 'KNOWLEDGE_SYNC_BUSY'
  | 'KNOWLEDGE_SYNC_FAILED'
  | 'KNOWLEDGE_SEARCH_FAILED'
  | 'STORE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface Capability {
  id: 'model' | 'voice' | 'memory' | 'tools' | 'connectors' | 'computer' | 'knowledge';
  label: string;
  state: 'available' | 'planned' | 'unavailable';
  detail: string;
}
