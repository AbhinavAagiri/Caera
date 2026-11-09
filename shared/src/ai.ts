import type { IsoTimestamp } from './conversations.js';
import type { ProviderKeySource, ProviderState } from './system.js';

export type AiProviderId = 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'ollama';
export type UsageMode = 'economy' | 'balanced' | 'maximum';
export type RoutingMethod = 'manual' | 'automatic' | 'fallback';
export type AiTaskCategory =
  | 'general_conversation'
  | 'simple_question'
  | 'research'
  | 'summarization'
  | 'coding'
  | 'complex_reasoning'
  | 'long_context'
  | 'image_understanding'
  | 'tool_execution'
  | 'planning';

export interface ModelCapabilities {
  streaming: boolean | null;
  vision: boolean | null;
  tools: boolean | null;
  json: boolean | null;
}

export interface ModelPricing {
  currency: 'USD';
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number | null;
  /** Standard list price. Provider promotions, tiers and taxes can differ. */
  sourceUrl: string;
  checkedAt: IsoTimestamp;
  note: string;
}

export interface AiModel {
  /** Stable UI reference: `<provider>/<model id>`. */
  ref: string;
  provider: AiProviderId;
  id: string;
  displayName: string;
  capabilities: ModelCapabilities;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  pricing: ModelPricing | null;
  availability: 'available' | 'unavailable';
  source: 'curated' | 'discovered';
  metadataSource: string | null;
  verifiedAt: IsoTimestamp | null;
}

export interface AiProviderSnapshot {
  id: AiProviderId;
  label: string;
  description: string;
  state: ProviderState;
  configured: boolean;
  requiresKey: boolean;
  keySource: ProviderKeySource;
  hasStoredKey: boolean;
  endpoint: string | null;
  detail: string;
  lastCheckedAt: IsoTimestamp | null;
  models: AiModel[];
  /** Model-discovery failures are not promoted to fatal provider errors. */
  discoveryError: string | null;
}

export interface AiSettings {
  mode: UsageMode;
  /** null means automatic routing. Otherwise a model ref such as `openai/gpt-5.5`. */
  defaultModel: string | null;
  /**
   * Primary model tried first by automatic routing. It must still be a
   * verified curated model and pass capability, availability and budget checks.
   * null disables the preference and lets the router rank all verified models.
   */
  autoPreferredModel: string | null;
  preferredProviders: AiProviderId[];
  excludedModels: string[];
  fallbackEnabled: boolean;
  /** null means no local limit. Zero blocks every model with a positive or unknown cost. */
  dailyLimitUsd: number | null;
  monthlyLimitUsd: number | null;
}

export interface AiSettingsInput extends Partial<AiSettings> {
  /** Required when either spending limit changes. */
  confirmSpendingChange?: boolean;
}

export interface SpendingSummary {
  dailyLimitUsd: number | null;
  monthlyLimitUsd: number | null;
  spentTodayUsd: number;
  spentThisMonthUsd: number;
  todayRequests: number;
  monthRequests: number;
  unpricedRequestsThisMonth: number;
}

export interface AiUsageRecord {
  id: string;
  conversationId: string | null;
  provider: AiProviderId;
  model: string;
  modelRef: string;
  taskCategory: AiTaskCategory;
  complexity: number;
  routingMethod: RoutingMethod;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  /** Computed from provider-reported token counts and a published list price. */
  estimatedCostUsd: number | null;
  pricingSourceUrl: string | null;
  durationMs: number;
  status: 'completed' | 'failed' | 'stopped';
  errorCode: string | null;
  createdAt: IsoTimestamp;
}

export interface AiSnapshot {
  providers: AiProviderSnapshot[];
  models: AiModel[];
  settings: AiSettings;
  spending: SpendingSummary;
  usage: AiUsageRecord[];
  systemInstruction: string;
  defaultSystemInstruction: string;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface ProviderCredentialInput {
  apiKey?: string;
  endpoint?: string;
}

export interface AiRouteRequest {
  content: string;
  /** Per-message override, or "auto" to bypass a saved default. */
  overrideModel?: string | null;
  mode?: UsageMode;
}

export interface ModelRoute {
  model: AiModel;
  taskCategory: AiTaskCategory;
  complexity: number;
  routingMethod: RoutingMethod;
  mode: UsageMode;
  rationale: string;
  fallbackCandidates: AiModel[];
}

export interface RoutePreview {
  route: ModelRoute | null;
  error: string | null;
  category: AiTaskCategory;
  complexity: number;
}
