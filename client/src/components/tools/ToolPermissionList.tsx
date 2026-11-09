import { useCallback, useEffect, useState } from 'react';
import type {
  PermissionLevel,
  PermissionSnapshot,
  ToolDefinition,
  ToolId,
} from '@shared';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Controls';
import { Chip } from '@/components/ui/Indicators';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { api, toApiError } from '@/services/api';

const LEVELS: PermissionLevel[] = ['allow', 'ask', 'block'];

const LEVEL_OPTIONS = [
  { value: 'ask', label: 'Ask every time' },
  { value: 'allow', label: 'Allow' },
  { value: 'block', label: 'Block' },
];

const TOOL_ICON: Record<ToolId, IconName> = {
  files: 'folder',
  clipboard: 'copy',
  applications: 'external',
  shell: 'code',
  screen: 'monitor',
};

const RISK_TONE: Record<ToolDefinition['risk'], 'neutral' | 'warn' | 'danger'> = {
  low: 'neutral',
  medium: 'warn',
  high: 'danger',
};

export function ToolPermissionList({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const { push } = useToast();
  const [snapshot, setSnapshot] = useState<PermissionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<ToolId | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setSnapshot(await api.permissions());
      setError(null);
    } catch (cause) {
      setError(toApiError(cause).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (tool: ToolDefinition, level: PermissionLevel): Promise<void> => {
    const previous = snapshot;
    setSnapshot((current) =>
      current
        ? {
            ...current,
            tools: current.tools.map((item) =>
              item.id === tool.id ? { ...item, level } : item,
            ),
          }
        : current,
    );
    setSavingId(tool.id);

    try {
      const next = await api.setPermission(tool.id, level);
      setSnapshot(next);
      push(`${tool.label} set to ${level}`, {
        detail: 'Stored on this device.',
        tone: 'success',
      });
    } catch (cause) {
      setSnapshot(previous);
      push('Could not save permission', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setSavingId(null);
    }
  };

  if (loading && !snapshot) {
    return (
      <div className="divide-y divide-line" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex items-center justify-between gap-6 px-4 py-4">
            <div className="space-y-1.5">
              <div className="h-[9px] w-[128px] rounded-full bg-raised" />
              <div className="h-[7px] w-[220px] rounded-full bg-raised/60" />
            </div>
            <div className="h-[30px] w-[140px] rounded-[7px] border border-line bg-raised" />
          </div>
        ))}
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <p className="text-[12px] text-ink-3">{error}</p>
        <Button size="sm" variant="secondary" icon="refresh" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="divide-y divide-line">
      {snapshot?.tools.map((tool) => (
        <div
          key={tool.id}
          className={cn(
            'flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4',
            compact ? 'py-3' : 'py-4',
          )}
        >
          <div className="min-w-0 max-w-[58ch]">
            <div className="flex flex-wrap items-center gap-2">
              <Icon name={TOOL_ICON[tool.id]} size={15} className="shrink-0 text-ink-3" />
              <span className="text-[13px] text-ink">{tool.label}</span>
              <Chip tone={RISK_TONE[tool.risk]}>{tool.risk} risk</Chip>
            </div>
            <p className="mt-1 pl-[23px] text-[12px] leading-[1.55] text-ink-3">{tool.summary}</p>
            {!compact ? (
              <p className="mt-1 max-w-[54ch] pl-[23px] text-[11.5px] leading-[1.55] text-ink-3">
                {tool.detail}
              </p>
            ) : null}
            <p className="mt-1 pl-[23px] font-mono text-[9px] text-ink-3">
              {tool.availability} · computer runtime planned
            </p>
          </div>

          <SelectField
            hideLabel
            label={`${tool.label} permission`}
            value={tool.level}
            disabled={savingId === tool.id}
            onChange={(next) => {
              if ((LEVELS as string[]).includes(next)) {
                void update(tool, next as PermissionLevel);
              }
            }}
            options={LEVEL_OPTIONS}
            className="w-[158px] shrink-0"
          />
        </div>
      ))}
    </div>
  );
}
