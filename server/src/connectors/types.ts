import type {
  ConnectorDescriptor,
  ConnectorDraftInput,
  ConnectorDraftPreview,
  ConnectorOperationResult,
} from '@shared';

export interface ConnectorRuntime {
  /** Non-secret configuration, safe to expose to the local client. */
  config: Record<string, string>;
  /** Secret values stay server-side and are never serialized in API responses. */
  secrets: Record<string, string>;
}

export interface ConnectorHealth {
  ok: boolean;
  detail: string;
  metadata?: Record<string, number | string>;
}

/**
 * A connector owns its transport and file/API details. The service layer owns
 * connection status, permissions, tool registration and activity events.
 */
export interface ConnectorAdapter {
  descriptor: ConnectorDescriptor;
  /** Validates and normalizes configuration before anything is persisted. */
  prepareConfig(input: Record<string, unknown>): ConnectorRuntime;
  /** Read-only check used by connect and the Connections page. */
  test(runtime: ConnectorRuntime): Promise<ConnectorHealth>;
  /** Executes one of the operations declared in the descriptor. */
  execute(
    operationId: string,
    args: Record<string, unknown>,
    runtime: ConnectorRuntime,
  ): Promise<ConnectorOperationResult>;
  /**
   * Builds the intended path and content for a new note without writing.
   * Adapters that support guided creation expose this.
   */
  previewCreate?(
    input: ConnectorDraftInput,
    runtime: ConnectorRuntime,
  ): Promise<ConnectorDraftPreview>;
  /**
   * Whether an operation needs a separate confirmation right now. This can
   * depend on saved configuration, unlike the static `destructive` flag.
   */
  requiresConfirmation?(operationId: string, runtime: ConnectorRuntime): boolean;
  /** Optional cleanup when the user disconnects. */
  disconnect?(runtime: ConnectorRuntime): Promise<void>;
}
