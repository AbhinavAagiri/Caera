import type { ReactNode } from 'react';
import { CaeraMark } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Indicators';
import { Note, Panel, PanelHeader, RowGroup, SectionHeading, SettingRow } from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { usePreferences } from '@/contexts/PreferencesContext';

function InfoRow({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right font-mono text-[10.5px] text-ink-2">{children}</dd>
    </div>
  );
}

export function AboutSection(): React.JSX.Element {
  const { report } = useLocalNode();
  const { reset } = usePreferences();
  const { push } = useToast();

  const copyDiagnostics = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          { capturedAt: new Date().toISOString(), report },
          null,
          2,
        ),
      );
      push('Diagnostics copied', { detail: 'Node and capability state only.', tone: 'success' });
    } catch {
      push('Clipboard unavailable', { tone: 'error' });
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading title="About CAERA" description="A local-first personal AI environment for Windows 11." />

      <Panel>
        <div className="flex items-start gap-4 px-4 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-[8px] border border-line bg-raised text-accent">
            <CaeraMark size={26} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-medium tracking-[0.14em] text-ink">CAERA</h3>
              <Chip tone="neutral">v{report?.version ?? '0.1.0'}</Chip>
              <Chip tone="neutral">Phase 2</Chip>
            </div>
            <p className="mt-1.5 max-w-[58ch] text-[12px] leading-[1.65] text-ink-3">
              Conversations, preferences and permissions stay on this PC. There are no accounts, no
              telemetry and no hosted backend.
            </p>
          </div>
        </div>
        <div className="border-t border-line px-4 py-1">
          <dl className="divide-y divide-line">
            <InfoRow label="Build">react · typescript · vite · tailwind</InfoRow>
            <InfoRow label="Local node">express · node {report?.platform ?? 'win32'}</InfoRow>
            <InfoRow label="Phase">{report?.phase ?? 'phase-2'}</InfoRow>
            <InfoRow label="Model">{report?.provider.model ?? 'unset'}</InfoRow>
            <InfoRow label="Voice engine">
              {report
                ? report.voice.state === 'ready'
                  ? `voicestudio ${report.voice.version ? `v${report.voice.version}` : ''} · ${report.voice.enabled ? 'output on' : 'output off'}`
                  : `voicestudio · ${report.voice.state}`
                : 'voicestudio · unknown'}
            </InfoRow>
            <InfoRow label="Data folder">
              <span className="break-all">{report?.storage.dataDirectory ?? 'unavailable offline'}</span>
            </InfoRow>
          </dl>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="text-[11.5px] text-ink-3">Architecture, design tokens and roadmap live in /docs.</p>
          <Button size="sm" variant="secondary" icon="copy" onClick={() => void copyDiagnostics()}>
            Copy diagnostics
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Capabilities"
          description="What the local node can actually do right now."
        />
        <RowGroup>
          {(report?.capabilities ?? []).map((capability) => (
            <SettingRow
              key={capability.id}
              label={capability.label}
              description={capability.detail}
            >
              <Chip tone={capability.state === 'available' ? 'ok' : 'neutral'}>
                {capability.state}
              </Chip>
            </SettingRow>
          ))}
          {!report ? (
            <div className="px-4 py-3.5 text-[12px] text-ink-3">
              The local node is offline, so capabilities cannot be read.
            </div>
          ) : null}
        </RowGroup>
      </Panel>

      <Note>
        CAERA is designed to be auditable. Provider checks, voice speech and future tool calls appear
        in the Activity panel with their source and outcome. Text is never logged for spoken replies.
      </Note>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[11.5px] text-ink-3">
          Reset theme, density, startup and memory preferences. Voice settings are kept.
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            reset();
            push('Preferences reset', { detail: 'Conversations and permissions were kept.', tone: 'success' });
          }}
        >
          Reset preferences
        </Button>
      </div>
    </div>
  );
}
