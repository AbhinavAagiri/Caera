import { useEffect, useState } from 'react';
import type {
  AiModel,
  AiProviderId,
  AiProviderSnapshot,
  AiSnapshot,
  AiUsageRecord,
  UsageMode,
} from '@shared';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Indicators';
import {
  SegmentedControl,
  Switch,
  TextAreaField,
  TextField,
} from '@/components/ui/Controls';
import { Note, Panel, PanelHeader, RowGroup, SectionHeading, SettingRow } from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { api, isAbortError, toApiError } from '@/services/api';

type ChipTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
type Busy = Partial<Record<AiProviderId, 'saving' | 'testing' | 'removing'>>;

const MODE_OPTIONS: ReadonlyArray<{ value: UsageMode; label: string }> = [
  { value: 'economy', label: 'Economy' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'maximum', label: 'Maximum' },
];

const TASK_LABELS: Record<string, string> = {
  general_conversation: 'Conversation',
  simple_question: 'Simple question',
  research: 'Research',
  summarization: 'Summarization',
  coding: 'Coding',
  complex_reasoning: 'Complex reasoning',
  long_context: 'Long context',
  image_understanding: 'Image understanding',
  tool_execution: 'Tool execution',
  planning: 'Planning',
};

const LIMIT_LABEL = 'USD';

function providerTone(state: AiProviderSnapshot['state']): ChipTone {
  if (state === 'connected') return 'ok';
  if (state === 'configured') return 'accent';
  if (state === 'error') return 'danger';
  return 'neutral';
}

function providerLabel(state: AiProviderSnapshot['state']): string {
  if (state === 'connected') return 'Connected';
  if (state === 'configured') return 'Key saved';
  if (state === 'error') return 'Error';
  return 'Not configured';
}

function formatMoney(value: number | null, digits = 4): string {
  if (value === null) return 'Not priced';
  if (value === 0) return '$0';
  return `$${value.toFixed(digits)}`;
}

function formatTokens(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat().format(value);
}

function formatCount(value: number | null): string {
  if (value === null) return 'Unknown';
  return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value);
}

function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function limitInput(value: number | null): string {
  return value === null ? '' : String(value);
}

function parseLimit(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) return 'invalid';
  return Math.round(parsed * 100) / 100;
}

function capabilities(model: AiModel): string[] {
  const values: Array<[string, boolean | null]> = [
    ['Streaming', model.capabilities.streaming],
    ['Vision', model.capabilities.vision],
    ['Tools', model.capabilities.tools],
    ['JSON', model.capabilities.json],
  ];
  return values.map(([label, value]) => `${label}: ${value === null ? 'unknown' : value ? 'yes' : 'no'}`);
}

function usageTone(record: AiUsageRecord): ChipTone {
  if (record.status === 'completed') return 'ok';
  if (record.status === 'stopped') return 'warn';
  return 'danger';
}

export function ModelUsageSection(): React.JSX.Element {
  const { push } = useToast();
  const { refresh: refreshNode } = useLocalNode();
  const [snapshot, setSnapshot] = useState<AiSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const [mode, setMode] = useState<UsageMode>('balanced');
  const [defaultModel, setDefaultModel] = useState('auto');
  const [autoPreferredModel, setAutoPreferredModel] = useState('');
  const [preferred, setPreferred] = useState<AiProviderId[]>([]);
  const [excludedText, setExcludedText] = useState('');
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [dailyLimit, setDailyLimit] = useState('');
  const [monthlyLimit, setMonthlyLimit] = useState('');
  const [confirmSpend, setConfirmSpend] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [savingInstruction, setSavingInstruction] = useState(false);

  const applySnapshot = (next: AiSnapshot): void => {
    setSnapshot(next);
    setMode(next.settings.mode);
    setDefaultModel(next.settings.defaultModel ?? 'auto');
    setAutoPreferredModel(next.settings.autoPreferredModel ?? '');
    setPreferred(next.settings.preferredProviders);
    setExcludedText(next.settings.excludedModels.join('\n'));
    setFallbackEnabled(next.settings.fallbackEnabled);
    setDailyLimit(limitInput(next.settings.dailyLimitUsd));
    setMonthlyLimit(limitInput(next.settings.monthlyLimitUsd));
    setConfirmSpend(false);
    setInstruction(next.systemInstruction);
  };

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    api
      .aiSnapshot(controller.signal)
      .then((next) => {
        if (!alive) return;
        applySnapshot(next);
        setDrafts(
          Object.fromEntries(
            next.providers.map((provider) => [
              provider.id,
              provider.id === 'ollama' ? (provider.endpoint ?? '') : '',
            ]),
          ),
        );
        setLoadError(null);
      })
      .catch((cause) => {
        if (!alive || isAbortError(cause)) return;
        setLoadError(toApiError(cause).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const setProviderBusy = (provider: AiProviderId, state: Busy[AiProviderId]): void => {
    setBusy((current) => {
      const next = { ...current };
      if (state) next[provider] = state;
      else delete next[provider];
      return next;
    });
  };

  const saveProvider = async (provider: AiProviderSnapshot): Promise<void> => {
    const value = (drafts[provider.id] ?? '').trim();
    if (provider.requiresKey && !value) return;
    setProviderBusy(provider.id, 'saving');
    try {
      const input = provider.id === 'ollama' ? { endpoint: value } : { apiKey: value };
      const next = await api.saveAiProvider(provider.id, input);
      const saved = next.providers.find((candidate) => candidate.id === provider.id);
      setSnapshot(next);
      setDrafts((current) => ({
        ...current,
        [provider.id]: provider.id === 'ollama' ? (saved?.endpoint ?? value) : '',
      }));
      refreshNode();
      push(provider.id === 'ollama' ? 'Ollama endpoint saved' : `${provider.label} key saved`, {
        detail: 'Stored by the local node. The key is never returned to this page.',
        tone: 'success',
      });
    } catch (cause) {
      push('Could not save provider access', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setProviderBusy(provider.id, undefined);
    }
  };

  const testProvider = async (provider: AiProviderSnapshot): Promise<void> => {
    setProviderBusy(provider.id, 'testing');
    try {
      const result = await api.testAiProvider(provider.id);
      setSnapshot(result.snapshot);
      refreshNode();
      const tested = result.provider;
      push(
        tested.state === 'connected'
          ? `${provider.label} connection verified`
          : tested.state === 'error'
            ? `${provider.label} connection failed`
            : `${provider.label} is not configured`,
        {
          detail: tested.detail,
          tone: tested.state === 'connected' ? 'success' : tested.state === 'error' ? 'error' : 'warning',
        },
      );
    } catch (cause) {
      push(`Could not test ${provider.label}`, {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setProviderBusy(provider.id, undefined);
    }
  };

  const removeProvider = async (provider: AiProviderSnapshot): Promise<void> => {
    if (
      !window.confirm(
        `Remove the saved ${provider.label} credential? The provider will stop being available to CAERA.`,
      )
    ) {
      return;
    }
    setProviderBusy(provider.id, 'removing');
    try {
      const next = await api.removeAiProvider(provider.id);
      setSnapshot(next);
      setDrafts((current) => ({ ...current, [provider.id]: '' }));
      refreshNode();
      push(`${provider.label} credential removed`, {
        detail:
          next.providers.find((candidate) => candidate.id === provider.id)?.keySource ===
          'environment'
            ? 'A key supplied in the server environment is still available.'
            : 'The provider is no longer used for routing.',
        tone: 'success',
      });
    } catch (cause) {
      push('Could not remove the credential', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setProviderBusy(provider.id, undefined);
    }
  };

  const togglePreferred = (provider: AiProviderId): void => {
    setPreferred((current) =>
      current.includes(provider)
        ? current.filter((candidate) => candidate !== provider)
        : [...current, provider],
    );
  };

  const dailyValue = parseLimit(dailyLimit);
  const monthlyValue = parseLimit(monthlyLimit);
  const limitsValid = dailyValue !== 'invalid' && monthlyValue !== 'invalid';
  const currentDaily = snapshot?.settings.dailyLimitUsd ?? null;
  const currentMonthly = snapshot?.settings.monthlyLimitUsd ?? null;
  const limitsChanged = dailyValue !== currentDaily || monthlyValue !== currentMonthly;

  const saveSettings = async (): Promise<void> => {
    if (!snapshot || !limitsValid) return;
    if (limitsChanged && !confirmSpend) {
      push('Spending change needs confirmation', {
        detail: 'Tick the confirmation for the new daily and monthly limits before saving.',
        tone: 'warning',
      });
      return;
    }

    setSavingSettings(true);
    try {
      const result = await api.updateAiSettings({
        mode,
        defaultModel: defaultModel === 'auto' ? null : defaultModel,
        autoPreferredModel: autoPreferredModel || null,
        preferredProviders: preferred,
        excludedModels: excludedText
          .split(/[\n,]+/)
          .map((value) => value.trim())
          .filter(Boolean),
        fallbackEnabled,
        dailyLimitUsd: dailyValue,
        monthlyLimitUsd: monthlyValue,
        confirmSpendingChange: limitsChanged,
      });
      applySnapshot(result.snapshot);
      refreshNode();
      push('Routing preferences saved', {
        detail: 'New turns use these defaults. A per-message choice still overrides the default model.',
        tone: 'success',
      });
    } catch (cause) {
      push('Could not save routing preferences', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const saveInstruction = async (): Promise<void> => {
    setSavingInstruction(true);
    try {
      await api.updateProviderConfig({ systemInstruction: instruction });
      const next = await api.aiSnapshot();
      setSnapshot(next);
      setInstruction(next.systemInstruction);
      push(instruction.trim() ? 'Workspace instruction saved' : 'Default instruction restored', {
        detail: 'The selected model receives this instruction; credentials stay local.',
        tone: 'success',
      });
    } catch (cause) {
      push('Could not save the instruction', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setSavingInstruction(false);
    }
  };

  const reloadSnapshot = async (): Promise<void> => {
    try {
      const next = await api.aiSnapshot();
      applySnapshot(next);
      setSnapshot(next);
      setLoadError(null);
      push('Usage refreshed');
    } catch (cause) {
      push('Could not refresh usage', { detail: toApiError(cause).message, tone: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <SectionHeading
          title="Models & usage"
          description="Provider-neutral routing, credentials, preferences and recorded usage."
        />
        <Note>Loading the model registry and local usage records…</Note>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="space-y-5">
        <SectionHeading
          title="Models & usage"
          description="Provider-neutral routing, credentials, preferences and recorded usage."
        />
        <Note tone="warn">
          The model settings could not be loaded: {loadError ?? 'the local node did not answer.'}
        </Note>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  const settings = snapshot.settings;
  const models = snapshot.models;
  const selectedDefault = models.find((model) => model.ref === settings.defaultModel);
  const automaticModels = models.filter(
    (model) => model.source === 'curated' && model.capabilities.streaming === true,
  );

  return (
    <div className="space-y-7">
      <SectionHeading
        title="Models & usage"
        description="CAERA routes each turn to a configured model. Keys stay in the local node; the browser never receives them."
        aside={
          <Chip tone={models.length > 0 ? 'ok' : 'warn'}>
            {models.length > 0 ? `${models.length} models available` : 'No model connected'}
          </Chip>
        }
      />

      {loadError ? <Note tone="warn">The last sync reported: {loadError}</Note> : null}

      <div className="space-y-3">
        <SectionHeading
          title="Providers"
          description="Each provider has its own adapter. A saved credential makes its verified models eligible for routing."
        />

        {snapshot.providers.map((provider) => {
          const state = busy[provider.id];
          const providerModels = provider.models;
          const isOllama = provider.id === 'ollama';
          const draft = drafts[provider.id] ?? '';
          return (
            <Panel key={provider.id}>
              <PanelHeader
                title={provider.label}
                description={provider.description}
                action={
                  <div className="flex items-center gap-2">
                    <Chip tone={providerTone(provider.state)}>{providerLabel(provider.state)}</Chip>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void testProvider(provider)}
                      disabled={Boolean(state) || !provider.configured}
                    >
                      {state === 'testing' ? 'Testing…' : 'Test connection'}
                    </Button>
                  </div>
                }
              />
              <div className="space-y-3 px-4 py-3.5">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <TextField
                    label={isOllama ? 'Loopback endpoint' : `${provider.label} API key`}
                    type={isOllama ? 'text' : 'password'}
                    value={draft}
                    onChange={(next) =>
                      setDrafts((current) => ({ ...current, [provider.id]: next }))
                    }
                    placeholder={
                      isOllama
                        ? 'http://127.0.0.1:11434'
                        : provider.hasStoredKey
                          ? 'A saved key is active — enter a new one to replace it'
                          : provider.keySource === 'environment'
                            ? 'A server environment key is active'
                            : 'Paste the key'
                    }
                    autoComplete="off"
                    disabled={Boolean(state)}
                    hint={
                      provider.keySource === 'settings'
                        ? 'Saved in the local node. Replace it here, or remove it below.'
                        : provider.keySource === 'environment'
                          ? 'Read from the local node environment. It is not shown to the browser.'
                          : isOllama
                            ? 'Only loopback addresses are accepted.'
                            : provider.id === 'gemini'
                              ? 'Stored in server/.data/provider.json with owner-only permissions.'
                              : 'Stored in server/.data/ai-providers.json with owner-only permissions.'
                    }
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void saveProvider(provider)}
                      disabled={
                        Boolean(state) || (provider.requiresKey && !draft.trim()) || (isOllama && !draft.trim())
                      }
                    >
                      {state === 'saving' ? 'Saving…' : 'Save & connect'}
                    </Button>
                    {provider.hasStoredKey ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void removeProvider(provider)}
                        disabled={Boolean(state)}
                      >
                        {state === 'removing' ? 'Removing…' : 'Remove key'}
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-ink-3">
                  <span>
                    Key source: <span className="text-ink-2">{provider.keySource}</span>
                  </span>
                  {provider.endpoint ? (
                    <span className="font-mono text-[9.5px] text-ink-4">{provider.endpoint}</span>
                  ) : null}
                  {provider.lastCheckedAt ? (
                    <span>Last checked {when(provider.lastCheckedAt)}</span>
                  ) : null}
                </div>

                <p className="text-[11px] leading-[1.6] text-ink-3">{provider.detail}</p>
                {provider.discoveryError ? (
                  <Note tone="warn">
                    Model discovery failed: {provider.discoveryError} Existing verified models are
                    still listed; no capabilities were inferred from the failure.
                  </Note>
                ) : null}

                <div className="space-y-2 border-t border-line pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-ink-4">Models</p>
                    <span className="font-mono text-[9px] text-ink-4">
                      {providerModels.length} eligible
                    </span>
                  </div>
                  {providerModels.length === 0 ? (
                    <p className="text-[11px] text-ink-3">
                      {provider.configured
                        ? 'No models have been verified for this provider. Models appear after a successful discovery or from the maintained registry.'
                        : 'Connect this provider to make its models available to the router.'}
                    </p>
                  ) : (
                    <div className="grid gap-2 lg:grid-cols-2">
                      {providerModels.map((model) => (
                        <div key={model.ref} className="rounded-[5px] border border-line bg-base/45 p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-[11.5px] text-ink">{model.displayName}</p>
                              <p className="mt-0.5 truncate font-mono text-[9px] text-ink-4">
                                {model.ref}
                              </p>
                            </div>
                            <Chip tone={model.source === 'curated' ? 'accent' : 'neutral'}>
                              {model.source === 'curated' ? 'Curated' : 'Discovered'}
                            </Chip>
                          </div>
                          <p className="mt-1.5 text-[9.5px] leading-[1.6] text-ink-3">
                            {capabilities(model).join(' · ')}
                          </p>
                          <p className="mt-1 text-[9.5px] text-ink-4">
                            Context {formatCount(model.contextWindow)} · max output{' '}
                            {formatCount(model.maxOutputTokens)}
                          </p>
                          <p className="mt-1 text-[9.5px] leading-[1.5] text-ink-4">
                            {model.pricing
                              ? `List price: $${model.pricing.inputPerMillion}/M input, $${model.pricing.outputPerMillion}/M output (estimate)`
                              : 'Pricing not verified. Spending estimates stay unknown for this model.'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      <div className="space-y-3">
        <SectionHeading
          title="Routing preferences"
          description="Automatic routing uses the task classifier, eligible models and these preferences. A hard budget is checked before a request starts."
        />
        <Panel>
          <PanelHeader
            title="Default behavior"
            description="These choices apply to new turns. The model control beside the composer can override the default for a single message."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void saveSettings()}
                disabled={savingSettings || !limitsValid || (limitsChanged && !confirmSpend)}
              >
                {savingSettings ? 'Saving…' : 'Save preferences'}
              </Button>
            }
          />
          <RowGroup>
            <SettingRow
              label="Usage mode"
              description="Economy prefers the lowest-cost capable model. Balanced weighs quality and cost. Maximum prefers the strongest capable model."
            >
              <SegmentedControl
                value={mode}
                onChange={setMode}
                options={MODE_OPTIONS}
                label="Default usage mode"
                size="sm"
              />
            </SettingRow>
            <SettingRow
              label="Default model"
              description={
                defaultModel === 'auto'
                  ? 'Automatic routing chooses a model for every turn.'
                  : selectedDefault
                    ? `${selectedDefault.displayName} is used unless a turn overrides it.`
                    : 'The saved model is no longer in the verified registry.'
              }
            >
              <select
                value={defaultModel}
                onChange={(event) => setDefaultModel(event.target.value)}
                aria-label="Default model"
                className="h-[30px] max-w-[260px] rounded-[5px] border border-line bg-raised px-2 text-[11px] text-ink outline-none focus:border-line-strong"
              >
                <option value="auto">Auto — let CAERA route</option>
                {snapshot.providers
                  .filter((provider) => provider.configured)
                  .map((provider) => {
                    const options = models.filter((model) => model.provider === provider.id);
                    if (options.length === 0) return null;
                    return (
                      <optgroup key={provider.id} label={provider.label}>
                        {options.map((model) => (
                          <option key={model.ref} value={model.ref}>
                            {model.displayName}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
              </select>
            </SettingRow>
            <SettingRow
              label="Automatic model preference"
              description={
                autoPreferredModel
                  ? 'This verified model is tried first whenever the default is Auto. Capability, availability, exclusion and budget checks still apply before it is used.'
                  : 'No preference. Automatic routing ranks all verified models for each task.'
              }
            >
              <select
                value={autoPreferredModel}
                onChange={(event) => setAutoPreferredModel(event.target.value)}
                aria-label="Automatic model preference"
                className="h-[30px] max-w-[260px] rounded-[5px] border border-line bg-raised px-2 text-[11px] text-ink outline-none focus:border-line-strong"
              >
                <option value="">No preference — rank verified models</option>
                {autoPreferredModel &&
                !automaticModels.some((model) => model.ref === autoPreferredModel) ? (
                  <option value={autoPreferredModel}>
                    {autoPreferredModel} — currently unavailable, ignored
                  </option>
                ) : null}
                {snapshot.providers
                  .filter((provider) => provider.configured)
                  .map((provider) => {
                    const options = automaticModels.filter(
                      (model) => model.provider === provider.id,
                    );
                    if (options.length === 0) return null;
                    return (
                      <optgroup key={provider.id} label={provider.label}>
                        {options.map((model) => (
                          <option key={model.ref} value={model.ref}>
                            {model.displayName}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
              </select>
            </SettingRow>
            <SettingRow
              label="Preferred providers"
              description="These providers win ties in automatic routing. They never override capability, availability, exclusions or budget."
            >
              <div className="flex max-w-[280px] flex-wrap justify-end gap-x-3 gap-y-2">
                {snapshot.providers.map((provider) => (
                  <label key={provider.id} className="flex items-center gap-1.5 text-[10.5px] text-ink-3">
                    <Switch
                      checked={preferred.includes(provider.id)}
                      onChange={() => togglePreferred(provider.id)}
                      label={`Prefer ${provider.label}`}
                    />
                    {provider.label}
                  </label>
                ))}
              </div>
            </SettingRow>
            <SettingRow
              label="Automatic fallback"
              description="After a retryable failure before any text is emitted, try the next configured verified model. Auth, configuration and safety failures are not retried. A local or free failure is never escalated to a paid model."
            >
              <Switch
                checked={fallbackEnabled}
                onChange={setFallbackEnabled}
                label="Automatic fallback"
              />
            </SettingRow>
            <div className="px-4 py-3">
              <TextAreaField
                label="Excluded models"
                value={excludedText}
                onChange={setExcludedText}
                rows={3}
                placeholder={'openai/gpt-5.5\nollama/llama3.1'}
                hint="One model reference per line. Excluded models are never chosen by automatic routing."
              />
            </div>
          </RowGroup>
        </Panel>

        <Panel>
          <PanelHeader
            title="Spending limits"
            description="Limits are evaluated against recorded token usage and published list prices, so they are protective estimates rather than a provider invoice."
          />
          <RowGroup>
            <SettingRow
              label="Daily limit"
              description={
                settings.dailyLimitUsd === 0
                  ? 'Hard zero: paid and unknown-priced requests are blocked today.'
                  : 'Requests that could exceed this amount are refused before they start.'
              }
            >
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] text-ink-4">{LIMIT_LABEL}</span>
                <TextField
                  label="Daily spending limit"
                  hideLabel
                  value={dailyLimit}
                  onChange={setDailyLimit}
                  placeholder="No limit"
                  className="w-[120px]"
                />
              </div>
            </SettingRow>
            <SettingRow
              label="Monthly limit"
              description={
                settings.monthlyLimitUsd === 0
                  ? 'Hard zero: paid and unknown-priced requests are blocked this month.'
                  : 'Blank means no local limit. A value of 0 blocks every model that could cost money.'
              }
            >
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] text-ink-4">{LIMIT_LABEL}</span>
                <TextField
                  label="Monthly spending limit"
                  hideLabel
                  value={monthlyLimit}
                  onChange={setMonthlyLimit}
                  placeholder="No limit"
                  className="w-[120px]"
                />
              </div>
            </SettingRow>
            {limitsChanged ? (
              <div className="px-4 py-3">
                <label className="flex cursor-pointer items-start gap-2.5 text-[11px] leading-[1.6] text-ink-3">
                  <input
                    type="checkbox"
                    checked={confirmSpend}
                    onChange={(event) => setConfirmSpend(event.target.checked)}
                    className="mt-0.5 accent-[var(--c-accent)]"
                  />
                  I confirm this spending-permission change. It applies to future requests; it does
                  not retroactively alter recorded usage.
                </label>
              </div>
            ) : null}
            {!limitsValid ? (
              <div className="px-4 py-3">
                <Note tone="danger">Limits must be empty or a number from 0 to 100,000.</Note>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="max-w-[56ch] text-[10.5px] leading-[1.6] text-ink-4">
                Zero is allowed and blocks any request that could incur a positive or unknown cost.
                Free and local models with verified zero pricing can still run.
              </p>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void saveSettings()}
                disabled={savingSettings || !limitsValid || (limitsChanged && !confirmSpend)}
              >
                {savingSettings ? 'Saving…' : 'Save preferences'}
              </Button>
            </div>
          </RowGroup>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Spending this period"
          description="Computed from recorded token counts and the listed prices for the models actually used."
          action={
            <Button size="sm" variant="ghost" onClick={() => void reloadSnapshot()}>
              Refresh
            </Button>
          }
        />
        <div className="grid gap-px bg-line sm:grid-cols-4">
          <div className="bg-surface px-4 py-3.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4">Today</p>
            <p className="mt-1.5 text-[18px] tracking-[-0.03em] text-ink">
              {formatMoney(snapshot.spending.spentTodayUsd)}
            </p>
            <p className="mt-0.5 text-[9.5px] text-ink-4">
              {snapshot.spending.todayRequests} requests · limit{' '}
              {snapshot.spending.dailyLimitUsd === null
                ? 'none'
                : formatMoney(snapshot.spending.dailyLimitUsd, 2)}
            </p>
          </div>
          <div className="bg-surface px-4 py-3.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4">This month</p>
            <p className="mt-1.5 text-[18px] tracking-[-0.03em] text-ink">
              {formatMoney(snapshot.spending.spentThisMonthUsd)}
            </p>
            <p className="mt-0.5 text-[9.5px] text-ink-4">
              {snapshot.spending.monthRequests} requests · limit{' '}
              {snapshot.spending.monthlyLimitUsd === null
                ? 'none'
                : formatMoney(snapshot.spending.monthlyLimitUsd, 2)}
            </p>
          </div>
          <div className="bg-surface px-4 py-3.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4">Unpriced</p>
            <p className="mt-1.5 text-[18px] tracking-[-0.03em] text-ink">
              {snapshot.spending.unpricedRequestsThisMonth}
            </p>
            <p className="mt-0.5 text-[9.5px] text-ink-4">This month, excluded from cost totals</p>
          </div>
          <div className="bg-surface px-4 py-3.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4">Privacy</p>
            <p className="mt-1.5 text-[11px] leading-[1.5] text-ink-2">Local records only</p>
            <p className="mt-0.5 text-[9.5px] leading-[1.5] text-ink-4">
              No provider receives another provider&apos;s credentials.
            </p>
          </div>
        </div>
        <div className="border-t border-line px-4 py-3">
          <Note>
            Token counts are shown only when the provider reports them. Costs are estimates from
            published list prices at the time the request ran; they are not invoices. Requests
            without a verified price remain unpriced rather than guessed.
          </Note>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Usage & routing history"
          description="The most recent requests, with the router's task classification and routing method."
        />
        {snapshot.usage.length === 0 ? (
          <div className="px-4 py-5 text-[11.5px] text-ink-3">
            No AI requests have been recorded yet. Send a message or run an Agent task and its
            reported usage will appear here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[9px] uppercase tracking-[0.08em] text-ink-4">
                  <th className="px-4 py-2 font-normal">When</th>
                  <th className="px-3 py-2 font-normal">Model</th>
                  <th className="px-3 py-2 font-normal">Task</th>
                  <th className="px-3 py-2 font-normal">Route</th>
                  <th className="px-3 py-2 font-normal">Tokens</th>
                  <th className="px-3 py-2 font-normal">Est. cost</th>
                  <th className="px-4 py-2 text-right font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.usage.map((record) => {
                  const model = models.find((candidate) => candidate.ref === record.modelRef);
                  return (
                    <tr key={record.id} className="border-b border-line/70 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 text-[10px] text-ink-3">
                        {when(record.createdAt)}
                        <span className="ml-1 text-ink-4">· {(record.durationMs / 1000).toFixed(1)}s</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-[10.5px] text-ink-2">{model?.displayName ?? record.model}</p>
                        <p className="font-mono text-[8.5px] text-ink-4">{record.modelRef}</p>
                      </td>
                      <td className="px-3 py-2.5 text-[10px] text-ink-3">
                        {TASK_LABELS[record.taskCategory] ?? record.taskCategory}
                        <span className="ml-1 text-ink-4">/ {record.complexity}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Chip tone={record.routingMethod === 'fallback' ? 'warn' : 'neutral'}>
                          {record.routingMethod}
                        </Chip>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[9.5px] text-ink-3">
                        {formatTokens(record.inputTokens)} in / {formatTokens(record.outputTokens)} out
                        {record.cachedTokens !== null ? (
                          <span className="block text-ink-4">{formatTokens(record.cachedTokens)} cached</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-[10px] text-ink-3">
                        {record.estimatedCostUsd === null ? 'Unpriced' : formatMoney(record.estimatedCostUsd)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Chip tone={usageTone(record)}>{record.status}</Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Workspace instruction"
          description="Applied to every provider. Provider adapters keep this separate from each provider's credentials."
        />
        <div className="space-y-3 px-4 py-3.5">
          <TextAreaField
            label="Instruction"
            hideLabel
            value={instruction}
            onChange={setInstruction}
            rows={5}
            maxLength={4000}
            hint="Stored locally. Leave blank to use the default CAERA instruction."
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10.5px] text-ink-4">
              Timeout {Math.round(snapshot.timeoutMs / 1000)}s · output cap{' '}
              {formatTokens(snapshot.maxOutputTokens)} tokens
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setInstruction(snapshot.defaultSystemInstruction)}
                disabled={savingInstruction}
              >
                Use default
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void saveInstruction()}
                disabled={savingInstruction}
              >
                {savingInstruction ? 'Saving…' : 'Save instruction'}
              </Button>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
