import type {
  AiModel,
  AiRouteRequest,
  AiSettings,
  AiTaskCategory,
  ModelRoute,
  SpendingSummary,
  UsageMode,
} from '@shared';
import type { TaskClassification } from './classifier';

export class RouteError extends Error {
  readonly code:
    | 'AI_MODEL_UNAVAILABLE'
    | 'AI_NO_SUITABLE_MODEL'
    | 'AI_BUDGET_EXCEEDED'
    | 'AI_SPENDING_CONFIRMATION_REQUIRED';
  readonly hint?: string;

  constructor(
    code: RouteError['code'],
    message: string,
    hint?: string,
  ) {
    super(message);
    this.name = 'RouteError';
    this.code = code;
    if (hint) this.hint = hint;
  }
}

/**
 * Automatic selection is restricted to models whose metadata has been checked
 * against the provider, not merely models returned by `/models` discovery.
 * Manual selection can still opt into a discovered model deliberately.
 */
export function isAutoVerified(model: AiModel): boolean {
  return (
    model.source === 'curated' &&
    model.verifiedAt !== null &&
    model.metadataSource !== null &&
    model.capabilities.streaming === true
  );
}

export interface RouteInput {
  request: AiRouteRequest;
  classification: TaskClassification;
  models: AiModel[];
  settings: AiSettings;
  spending: SpendingSummary;
  maxOutputTokens: number;
  /** Full serialized input size when available; content-only is a fallback. */
  inputBytes?: number;
}

function quality(model: AiModel): number {
  if (model.provider === 'openai' && model.id.includes('gpt-5.5')) return 96;
  if (model.provider === 'anthropic' && model.id.includes('opus-5-5')) return 98;
  if (model.provider === 'gemini' && model.id.includes('3.8-flash')) return 88;
  if (model.provider === 'gemini' && model.id.includes('3.6-flash')) return 84;
  if (model.provider === 'gemini' && model.id.includes('flash-lite')) return 64;
  if (model.provider === 'deepseek' && model.id.includes('v4-pro')) return 87;
  if (model.provider === 'deepseek' && model.id.includes('flash')) return 76;
  if (model.provider === 'ollama') return 58;
  return 50;
}

function costIndex(model: AiModel): number {
  if (model.provider === 'ollama') return 0;
  if (!model.pricing) return Number.POSITIVE_INFINITY;
  return model.pricing.inputPerMillion + model.pricing.outputPerMillion * 3;
}

function isFree(model: AiModel): boolean {
  return model.provider === 'ollama' ||
    (model.pricing?.inputPerMillion === 0 && model.pricing.outputPerMillion === 0);
}

export function estimateCost(
  model: AiModel,
  inputTokens: number | null,
  outputTokens: number | null,
  cachedTokens: number | null,
): number | null {
  if (!model.pricing || inputTokens === null || outputTokens === null) return null;
  const cached = Math.min(cachedTokens ?? 0, inputTokens);
  const uncached = Math.max(0, inputTokens - cached);
  const cachedPrice = model.pricing.cachedInputPerMillion ?? model.pricing.inputPerMillion;
  const cost =
    (uncached * model.pricing.inputPerMillion +
      cached * cachedPrice +
      outputTokens * model.pricing.outputPerMillion) /
    1_000_000;
  return Number.isFinite(cost) ? Math.round(cost * 100_000_000) / 100_000_000 : null;
}

/**
 * Conservative preflight. One byte is treated as at most one token. This can
 * reject a request early but cannot understate the provider's maximum bill.
 */
export function affordable(
  model: AiModel,
  settings: AiSettings,
  spending: SpendingSummary,
  inputBytes: number,
  maxOutputTokens: number,
): { ok: boolean; reason: string | null } {
  const hasLimit = settings.dailyLimitUsd !== null || settings.monthlyLimitUsd !== null;
  if (!hasLimit) return { ok: true, reason: null };

  if (model.provider === 'ollama' || isFree(model)) return { ok: true, reason: null };
  if (!model.pricing) {
    return {
      ok: false,
      reason: 'This model has no verified price, so a spending limit cannot be enforced safely.',
    };
  }

  const output = Math.min(maxOutputTokens, model.maxOutputTokens ?? maxOutputTokens);
  const reserved = ((inputBytes + output) * Math.max(model.pricing.inputPerMillion, model.pricing.outputPerMillion)) / 1_000_000;

  if (
    settings.dailyLimitUsd !== null &&
    spending.spentTodayUsd + reserved > settings.dailyLimitUsd
  ) {
    return {
      ok: false,
      reason: `The daily limit of $${settings.dailyLimitUsd.toFixed(2)} would be exceeded by the worst-case reservation for this request.`,
    };
  }

  if (
    settings.monthlyLimitUsd !== null &&
    spending.spentThisMonthUsd + reserved > settings.monthlyLimitUsd
  ) {
    return {
      ok: false,
      reason: `The monthly limit of $${settings.monthlyLimitUsd.toFixed(2)} would be exceeded by the worst-case reservation for this request.`,
    };
  }

  return { ok: true, reason: null };
}

function requiredCapabilityFailure(model: AiModel, classification: TaskClassification): string | null {
  if (classification.needsVision && model.capabilities.vision === false) {
    return 'The model is known not to support images.';
  }
  if (classification.needsVision && model.capabilities.vision === null) {
    return 'The model has no verified image capability.';
  }
  if (classification.needsTools && model.capabilities.tools === false) {
    return 'The model is known not to support tool calling.';
  }
  if (classification.needsTools && model.capabilities.tools === null) {
    return 'The model has no verified tool-calling capability.';
  }
  if (classification.needsLongContext) {
    if (model.contextWindow === null) return 'The model has no verified context limit.';
    if (model.contextWindow < classification.estimatedInputTokens) {
      return 'The model context window is too small for this request.';
    }
  }
  return null;
}

function orderFallback(
  candidates: AiModel[],
  mode: UsageMode,
  preferredProviders: string[],
  autoPreferredModel: string | null,
): AiModel[] {
  const ranked = rank(candidates, mode, preferredProviders);
  if (!autoPreferredModel) return ranked;
  const preferred = ranked.find((model) => model.ref === autoPreferredModel);
  return preferred ? [preferred, ...ranked.filter((model) => model.ref !== preferred.ref)] : ranked;
}

function rank(candidates: AiModel[], mode: UsageMode, preferred: string[]): AiModel[] {
  return [...candidates].sort((left, right) => {
    const preferredLeft = preferred.includes(left.provider) ? 1 : 0;
    const preferredRight = preferred.includes(right.provider) ? 1 : 0;

    if (mode === 'maximum') {
      return quality(right) - quality(left) || preferredRight - preferredLeft || costIndex(left) - costIndex(right);
    }

    if (mode === 'economy') {
      const freeLeft = isFree(left) ? 1 : 0;
      const freeRight = isFree(right) ? 1 : 0;
      if (freeLeft !== freeRight) return freeRight - freeLeft;
      const costLeft = costIndex(left);
      const costRight = costIndex(right);
      if (costLeft !== costRight) {
        if (!Number.isFinite(costLeft)) return 1;
        if (!Number.isFinite(costRight)) return -1;
        return costLeft - costRight;
      }
      return quality(right) - quality(left) || preferredRight - preferredLeft;
    }

    const score = (model: AiModel): number => {
      const cost = costIndex(model);
      const affordability = Number.isFinite(cost) ? Math.min(1, cost / 100) : 0.75;
      return quality(model) - affordability * 24 + (preferred.includes(model.provider) ? 8 : 0);
    };
    return score(right) - score(left);
  });
}

function methodFor(request: AiRouteRequest, settings: AiSettings): {
  method: 'manual' | 'automatic';
  ref: string | null;
} {
  if (request.overrideModel === 'auto') return { method: 'automatic', ref: null };
  if (request.overrideModel) return { method: 'manual', ref: request.overrideModel };
  if (settings.defaultModel) return { method: 'manual', ref: settings.defaultModel };
  return { method: 'automatic', ref: null };
}

function unavailable(reason: string, hint?: string): never {
  throw new RouteError('AI_MODEL_UNAVAILABLE', reason, hint);
}

export function routeTask(input: RouteInput): ModelRoute {
  const { request, classification, models, settings, spending, maxOutputTokens } = input;
  const inputBytes = input.inputBytes ?? Buffer.byteLength(request.content, 'utf8');
  const mode = request.mode ?? settings.mode;
  const selected = methodFor(request, settings);
  const configured = models.filter((model) => model.availability === 'available');
  const notExcluded = configured.filter((model) => !settings.excludedModels.includes(model.ref));

  if (selected.method === 'manual' && selected.ref) {
    const model = configured.find((candidate) => candidate.ref === selected.ref);
    if (!model) {
      unavailable(
        'The selected model is not available from a connected provider.',
        'Connect that provider, refresh its models, or choose Auto.',
      );
    }
    if (settings.excludedModels.includes(model.ref)) {
      unavailable('The selected model is excluded in Models & usage.');
    }
    const capability = requiredCapabilityFailure(model, classification);
    if (capability) unavailable(capability, 'Choose a different model for this request.');
    const budget = affordable(model, settings, spending, inputBytes, maxOutputTokens);
    if (!budget.ok) throw new RouteError('AI_BUDGET_EXCEEDED', budget.reason ?? 'Budget limit reached.', 'Increase the limit deliberately in Models & usage.');

    const fallbackPool = notExcluded.filter(
      (candidate) =>
        candidate.ref !== model.ref &&
        isAutoVerified(candidate) &&
        requiredCapabilityFailure(candidate, classification) === null &&
        affordable(candidate, settings, spending, inputBytes, maxOutputTokens).ok,
    );

    return {
      model,
      taskCategory: classification.category,
      complexity: classification.complexity,
      routingMethod: 'manual',
      mode,
      rationale: `You selected ${model.displayName}.`,
      fallbackCandidates: orderFallback(
        fallbackPool,
        mode,
        settings.preferredProviders,
        settings.autoPreferredModel,
      ),
    };
  }

  const eligible = notExcluded.filter((model) => {
    if (!isAutoVerified(model)) return false;
    if (requiredCapabilityFailure(model, classification)) return false;
    return affordable(model, settings, spending, inputBytes, maxOutputTokens).ok;
  });

  if (eligible.length === 0) {
    if (!notExcluded.some(isAutoVerified)) {
      throw new RouteError(
        'AI_NO_SUITABLE_MODEL',
        'Automatic routing needs a verified model, and none is connected.',
        'Connect a provider with curated metadata, or choose a discovered model manually. Unverified models are never selected automatically.',
      );
    }

    const anyCapability = notExcluded.some(
      (model) => isAutoVerified(model) && requiredCapabilityFailure(model, classification) === null,
    );
    if (anyCapability) {
      throw new RouteError(
        'AI_BUDGET_EXCEEDED',
        'No configured model is both suitable and within the active spending limits.',
        'Review the model pricing and spending limits in Models & usage. Unknown prices are not treated as free.',
      );
    }
    throw new RouteError(
      'AI_NO_SUITABLE_MODEL',
      'No connected model has the capabilities this task needs.',
      'Connect a provider with a suitable model or choose another task. Capabilities are not invented.',
    );
  }

  const ranked = rank(eligible, mode, settings.preferredProviders);
  const configuredPreference = settings.autoPreferredModel
    ? eligible.find((model) => model.ref === settings.autoPreferredModel)
    : undefined;
  const chosen = configuredPreference ?? ranked[0];
  if (!chosen) {
    throw new RouteError('AI_NO_SUITABLE_MODEL', 'No suitable verified model is currently available.');
  }

  const remaining = ranked.filter((model) => model.ref !== chosen.ref);
  return {
    model: chosen,
    taskCategory: classification.category,
    complexity: classification.complexity,
    routingMethod: selected.method,
    mode,
    rationale:
      selected.method === 'manual'
        ? `Your default model is ${chosen.displayName}.`
        : configuredPreference
          ? `The configured automatic preference ${chosen.displayName} passed availability, capability and budget checks.`
          : mode === 'economy'
            ? 'Economy mode chose the lowest-cost verified suitable model, preferring local and zero-cost models.'
            : mode === 'maximum'
              ? 'Maximum mode chose the highest-quality verified suitable model within your limits.'
              : 'Balanced mode weighed task needs, verified model quality, preferences and estimated cost.',
    fallbackCandidates: orderFallback(
      remaining,
      mode,
      settings.preferredProviders,
      settings.autoPreferredModel,
    ),
  };
}

export function categoryLabel(category: AiTaskCategory): string {
  return category.replace(/_/g, ' ');
}
