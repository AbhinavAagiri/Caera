import type { AiSnapshot } from '@shared';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';

export function ModelPicker({
  snapshot,
  value,
  onChange,
  onRemember,
  onConfigure,
  disabled = false,
  remembering = false,
}: {
  snapshot: AiSnapshot | null;
  value: string;
  onChange: (next: string) => void;
  onRemember: () => void;
  onConfigure: () => void;
  disabled?: boolean;
  remembering?: boolean;
}): React.JSX.Element {
  const models = snapshot?.models ?? [];
  const configuredProviders = (snapshot?.providers ?? []).filter((provider) => provider.configured);
  const selected = models.find((model) => model.ref === value);
  const mode = snapshot?.settings.mode ?? 'balanced';
  const defaultRef = snapshot?.settings.defaultModel ?? 'auto';
  const changed = value !== defaultRef;
  const selectedLabel = selected
    ? `${selected.displayName} · ${selected.provider}`
    : value === 'auto'
      ? `Auto · ${mode}`
      : 'Model unavailable';

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-[330px]">
        <Icon
          name="cpu"
          size={11}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4"
        />
        <select
          value={value}
          disabled={disabled || !snapshot}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Model for this message"
          title={selectedLabel}
          className={cn(
            'h-[25px] w-full appearance-none truncate rounded-[5px] border border-line bg-base/70 pl-7 pr-12 text-[10px] text-ink-3 outline-none t-ui hover:border-line-strong focus:border-line-strong',
            (disabled || !snapshot) && 'opacity-45',
          )}
        >
          <option value="auto">Auto · {mode}</option>
          {configuredProviders.map((provider) => {
            const providerModels = models.filter((model) => model.provider === provider.id);
            if (providerModels.length === 0) return null;
            return (
              <optgroup key={provider.id} label={provider.label}>
                {providerModels.map((model) => (
                  <option key={model.ref} value={model.ref}>
                    {model.displayName}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {selected?.pricing ? <span className="font-mono text-[8px] text-ink-4">$</span> : null}
          <Icon name="chevronDown" size={10} className="text-ink-4" />
        </span>
      </div>

      {changed ? (
        <button
          type="button"
          onClick={onRemember}
          disabled={disabled || remembering || !snapshot}
          className="shrink-0 text-[9.5px] text-ink-4 underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink-2 disabled:opacity-40"
          title="Save this choice as the default for new messages"
        >
          {remembering ? 'Saving…' : 'Set default'}
        </button>
      ) : null}

      {models.length === 0 ? (
        <Button size="sm" variant="ghost" onClick={onConfigure} className="h-[24px] px-2 text-[9.5px]">
          Connect model
        </Button>
      ) : null}
    </div>
  );
}
