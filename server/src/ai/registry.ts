import type { AiModel, AiProviderId, ModelPricing } from '@shared';

const CHECKED_AT = '2026-11-09T00:00:00.000Z';

function pricing(
  inputPerMillion: number,
  outputPerMillion: number,
  cachedInputPerMillion: number | null,
  sourceUrl: string,
  note: string,
): ModelPricing {
  return {
    currency: 'USD',
    inputPerMillion,
    outputPerMillion,
    cachedInputPerMillion,
    sourceUrl,
    checkedAt: CHECKED_AT,
    note,
  };
}

function curated(
  provider: AiProviderId,
  id: string,
  displayName: string,
  values: Omit<AiModel, 'ref' | 'provider' | 'id' | 'displayName' | 'source' | 'availability'>,
): AiModel {
  return {
    ref: `${provider}/${id}`,
    provider,
    id,
    displayName,
    availability: 'available',
    source: 'curated',
    ...values,
  };
}

/**
 * Only verified seats are listed here. A provider's live `/models` response is
 * merged at runtime, and unknown metadata remains unknown rather than guessed.
 * Prices are standard list prices and are always labelled as estimates in UI.
 */
export const CURATED_MODELS: ReadonlyArray<AiModel> = [
  curated('gemini', 'gemini-3.6-flash', 'Gemini 3.6 Flash', {
    capabilities: { streaming: true, vision: true, tools: true, json: true },
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: pricing(
      0.75,
      3.75,
      0.075,
      'https://ai.google.dev/gemini-api/docs/pricing',
      'Standard paid list price checked 2026-11-09. Free tier is rate-limited; promotional pricing runs through 2026-12-31.',
    ),
    metadataSource: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash',
    verifiedAt: CHECKED_AT,
  }),
  curated('gemini', 'gemini-3.8-flash', 'Gemini 3.8 Flash', {
    capabilities: { streaming: true, vision: true, tools: true, json: true },
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: pricing(
      0.75,
      3.75,
      0.075,
      'https://ai.google.dev/gemini-api/docs/pricing',
      'Standard paid list price checked 2026-11-09. Free-tier availability and quotas are not unlimited.',
    ),
    metadataSource: 'https://ai.google.dev/gemini-api/docs/pricing',
    verifiedAt: CHECKED_AT,
  }),
  curated('gemini', 'gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', {
    capabilities: { streaming: true, vision: null, tools: null, json: null },
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: pricing(
      0.3,
      2.5,
      0.03,
      'https://ai.google.dev/gemini-api/docs/pricing',
      'Standard paid list price checked 2026-11-09.',
    ),
    metadataSource: 'https://ai.google.dev/gemini-api/docs/pricing',
    verifiedAt: CHECKED_AT,
  }),
  curated('openai', 'gpt-5.5', 'GPT-5.5', {
    capabilities: { streaming: true, vision: true, tools: true, json: true },
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    pricing: pricing(
      5,
      30,
      0.5,
      'https://developers.openai.com/api/docs/models/gpt-5.5',
      'Standard list price checked 2026-11-09. Prompts over 272K input tokens use higher rates.',
    ),
    metadataSource: 'https://developers.openai.com/api/docs/models/gpt-5.5',
    verifiedAt: CHECKED_AT,
  }),
  curated('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5', {
    capabilities: { streaming: true, vision: null, tools: null, json: null },
    contextWindow: 1_000_000,
    maxOutputTokens: null,
    pricing: pricing(
      4,
      20,
      0.2,
      'https://platform.claude.com/docs/en/about-claude/pricing',
      'Standard list price checked 2026-11-09. Cache writes and long-context options can differ.',
    ),
    metadataSource: 'https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5',
    verifiedAt: CHECKED_AT,
  }),
  curated('deepseek', 'deepseek-flash', 'DeepSeek Flash', {
    capabilities: { streaming: true, vision: true, tools: true, json: true },
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    pricing: pricing(
      0.3,
      1.2,
      0.006,
      'https://api-docs.deepseek.com/quick_start/pricing',
      'Peak OpenAI-format list price checked 2026-11-09; off-peak rates are lower.',
    ),
    metadataSource: 'https://api-docs.deepseek.com/quick_start/pricing',
    verifiedAt: CHECKED_AT,
  }),
  curated('deepseek', 'deepseek-v4-pro', 'DeepSeek V4 Pro', {
    capabilities: { streaming: true, vision: false, tools: true, json: true },
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    pricing: pricing(
      1.32,
      3.96,
      0.044,
      'https://api-docs.deepseek.com/quick_start/pricing',
      'Peak OpenAI-format list price checked 2026-11-09; off-peak rates are lower.',
    ),
    metadataSource: 'https://api-docs.deepseek.com/quick_start/pricing',
    verifiedAt: CHECKED_AT,
  }),
];

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  deepseek: 'DeepSeek',
  ollama: 'Ollama (local)',
};

export const PROVIDER_DESCRIPTIONS: Record<AiProviderId, string> = {
  gemini: 'Google AI Studio API. Your key is used by this node only.',
  openai: 'OpenAI Chat Completions. Model access depends on your own account.',
  anthropic: 'Anthropic Messages API. Model access depends on your own account.',
  deepseek: 'DeepSeek OpenAI-compatible API using your own account.',
  ollama: 'Local Ollama instance on loopback. No traffic leaves this computer.',
};

export const PROVIDER_IDS: ReadonlyArray<AiProviderId> = [
  'gemini',
  'openai',
  'anthropic',
  'deepseek',
  'ollama',
];

export function curatedFor(provider: AiProviderId, id: string): AiModel | null {
  return CURATED_MODELS.find((model) => model.provider === provider && model.id === id) ?? null;
}

export function discoveredModel(provider: AiProviderId, id: string, displayName?: string): AiModel {
  const known = curatedFor(provider, id);
  if (known) return known;

  // The transport supports streaming, but context, vision, tools, JSON and
  // prices are deliberately unknown until verified from the provider.
  return {
    ref: `${provider}/${id}`,
    provider,
    id,
    displayName: displayName?.trim() || id,
    capabilities: { streaming: true, vision: null, tools: null, json: null },
    contextWindow: null,
    maxOutputTokens: null,
    pricing: null,
    availability: 'available',
    source: 'discovered',
    metadataSource: null,
    verifiedAt: null,
  };
}
