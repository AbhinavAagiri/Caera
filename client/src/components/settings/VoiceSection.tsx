import { useEffect, useState } from 'react';
import type { VoiceFormat, VoiceStartMode } from '@shared';
import { Button } from '@/components/ui/Button';
import { SegmentedControl, SelectField, Switch, TextField } from '@/components/ui/Controls';
import { Chip } from '@/components/ui/Indicators';
import { Note, Panel, PanelHeader, RowGroup, SectionHeading, SettingRow } from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { useVoiceSettings } from '@/hooks/useVoiceSettings';
import { formatRelative } from '@/lib/format';
import { api, toApiError } from '@/services/api';
import {
  getVoicePlaybackState,
  stopVoicePlayback,
  subscribeVoicePlayback,
  testVoice,
  type VoicePlaybackState,
} from '@/services/voicePlayback';

type ChipTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

function statusTone(state: string | undefined): ChipTone {
  if (state === 'ready') return 'ok';
  if (state === 'incompatible') return 'warn';
  if (state === 'error') return 'danger';
  if (state === 'starting') return 'warn';
  return 'neutral';
}

function statusLabel(state: string | undefined): string {
  if (state === 'ready') return 'Connected';
  if (state === 'unreachable') return 'Not reachable';
  if (state === 'incompatible') return 'Incompatible API';
  if (state === 'starting') return 'Starting';
  if (state === 'error') return 'Error';
  return 'Not checked';
}

function lifecycleTone(phase: string | undefined): ChipTone {
  if (phase === 'managed' || phase === 'external') return 'ok';
  if (phase === 'starting' || phase === 'unavailable') return 'warn';
  if (phase === 'failed') return 'danger';
  return 'neutral';
}

function lifecycleLabel(phase: string | undefined): string {
  if (phase === 'managed') return 'Managed by CAERA';
  if (phase === 'external') return 'Running independently';
  if (phase === 'starting') return 'Starting';
  if (phase === 'failed') return 'Start failed';
  if (phase === 'unavailable') return 'No launcher';
  if (phase === 'stopped') return 'Stopped';
  return 'Unknown';
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline decoration-[color-mix(in_oklab,var(--c-accent)_40%,transparent)] underline-offset-2 hover:text-ink"
    >
      {children}
    </a>
  );
}

export function VoiceSection(): React.JSX.Element {
  const voice = useVoiceSettings();
  const node = useLocalNode();
  const { push } = useToast();

  const [url, setUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [voiceId, setVoiceId] = useState('default');
  const [speed, setSpeed] = useState(1);
  const [format, setFormat] = useState<VoiceFormat>('mp3');
  const [autoStart, setAutoStart] = useState(true);
  const [startMode, setStartMode] = useState<VoiceStartMode>('startup');
  const [voiceStudioDir, setVoiceStudioDir] = useState('');
  const [dirty, setDirty] = useState(false);
  const [serviceBusy, setServiceBusy] = useState(false);
  const [playback, setPlayback] = useState<VoicePlaybackState>(getVoicePlaybackState);

  const settings = voice.settings;
  const configuration = settings?.configuration ?? null;
  const status = settings?.voice ?? node.report?.voice ?? null;
  const catalog = settings?.catalog ?? null;
  const connected = status?.state === 'ready';

  useEffect(() => {
    if (!configuration || dirty) return;
    setUrl(configuration.url);
    setEnabled(configuration.enabled);
    setAutoSpeak(configuration.autoSpeak);
    setVoiceId(configuration.voiceId);
    setSpeed(configuration.speed);
    setFormat(configuration.format);
    setAutoStart(configuration.autoStart);
    setStartMode(configuration.startMode);
    setVoiceStudioDir(configuration.voiceStudioDir ?? '');
  }, [configuration, dirty]);

  useEffect(() => subscribeVoicePlayback(setPlayback), []);

  useEffect(() => {
    return () => stopVoicePlayback();
  }, []);

  useEffect(() => {
    if (status?.lifecycle.phase !== 'starting' && status?.state !== 'starting') return;
    const timer = window.setInterval(() => {
      voice.refresh();
      node.refresh();
    }, 1_200);
    return () => window.clearInterval(timer);
  }, [status?.lifecycle.phase, status?.state, voice.refresh, node.refresh]);

  const voices = catalog?.voices ?? [];
  const selected = voices.find((entry) => entry.id === voiceId);
  const voiceName =
    selected?.name ??
    (voiceId === 'default' ? 'VoiceStudio default' : configuration?.voiceName ?? voiceId);

  const options = [
    { value: 'default', label: 'VoiceStudio default' },
    ...voices
      .filter((entry) => entry.id !== 'default')
      .map((entry) => ({
        value: entry.id,
        label: `${entry.name}${entry.kind === 'profile' ? ' · profile' : ''}`,
      })),
    ...(voiceId !== 'default' && !voices.some((entry) => entry.id === voiceId)
      ? [{ value: voiceId, label: `${configuration?.voiceName ?? voiceId} · saved` }]
      : []),
  ];

  const markDirty = (): void => setDirty(true);

  const save = async (patch?: { url?: string }): Promise<boolean> => {
    try {
      const result = await voice.save({
        url: patch?.url ?? url,
        enabled,
        autoSpeak,
        voiceId,
        voiceName,
        speed,
        format,
        autoStart,
        startMode,
        voiceStudioDir: voiceStudioDir.trim() || null,
      });
      setDirty(false);
      node.refresh();
      push(
        result.voice.state === 'ready' ? 'Voice settings saved' : 'Voice settings saved; service unavailable',
        {
          detail: result.voice.detail,
          tone: result.voice.state === 'ready' ? 'success' : 'warning',
        },
      );
      return true;
    } catch (cause) {
      push('Could not save voice settings', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
      return false;
    }
  };

  const startService = async (): Promise<void> => {
    if (!settings) return;
    if (dirty) {
      const saved = await save();
      if (!saved) return;
    }

    setServiceBusy(true);
    try {
      const result = await api.startVoiceService();
      voice.refresh();
      node.refresh();
      push(
        result.voice.lifecycle.phase === 'starting'
          ? 'Starting VoiceStudio'
          : result.voice.state === 'ready'
            ? 'VoiceStudio is running'
            : 'VoiceStudio did not start',
        { detail: result.voice.lifecycle.detail, tone: result.voice.state === 'ready' ? 'success' : 'warning' },
      );
    } catch (cause) {
      push('Could not start VoiceStudio', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setServiceBusy(false);
    }
  };

  const stopService = async (): Promise<void> => {
    setServiceBusy(true);
    try {
      const result = await api.stopVoiceService();
      voice.refresh();
      node.refresh();
      push('VoiceStudio stopped', {
        detail: result.voice.lifecycle.detail,
        tone: 'success',
      });
    } catch (cause) {
      push('Could not stop VoiceStudio', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setServiceBusy(false);
    }
  };

  const check = async (): Promise<void> => {
    try {
      const result = await voice.check();
      node.refresh();
      push(result.voice.state === 'ready' ? 'VoiceStudio connected' : 'VoiceStudio is not ready', {
        detail: result.voice.detail,
        tone: result.voice.state === 'ready' ? 'success' : 'warning',
      });
    } catch (cause) {
      push('VoiceStudio check failed', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    }
  };

  const runTest = async (): Promise<void> => {
    if (dirty) {
      const saved = await save();
      if (!saved) return;
    }

    try {
      await testVoice({ voiceId, speed, format });
    } catch (cause) {
      const error = toApiError(cause);
      const blocked =
        typeof cause === 'object' &&
        cause !== null &&
        'name' in cause &&
        (cause as { name?: string }).name === 'NotAllowedError';
      push(blocked ? 'Speech was generated but playback was blocked' : 'Voice test failed', {
        detail: blocked
          ? 'Press Test voice again, or allow audio playback for this page.'
          : error.message,
        tone: 'error',
      });
    }
  };

  const troubleshooting = (
    <Note tone="warn">
      <p className="font-medium text-ink">Voice output is unavailable. Text chat still works.</p>
      <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
        <li>
          Set a prepared VoiceStudio source checkout below. CAERA runs its documented{' '}
          <span className="font-mono text-[10px]">bun run dev:api</span> launcher without opening
          the desktop GUI.
        </li>
        <li>
          The desktop installer has no documented headless-only launcher, so CAERA does not open
          VoiceStudio&apos;s GUI. Start the desktop app yourself if you only have that install, or
          use a source checkout.
        </li>
        <li>
          Confirm the local API is listening on{' '}
          <span className="font-mono text-[10px]">http://localhost:3900</span>, or update the address
          above.
        </li>
        <li>Keep VoiceStudio on loopback. Do not expose port 3900 to your network or the internet.</li>
        <li>
          For voice input, load a speech-recognition model in VoiceStudio&apos;s Model Manager. CAERA
          reports a missing model instead of downloading one silently.
        </li>
        <li>Press Check again. If it still fails, update VoiceStudio and read its troubleshooting guide.</li>
      </ol>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <ExternalLink href="https://voicestudio.sh/download">Install VoiceStudio</ExternalLink>
        <ExternalLink href="https://github.com/debpalash/VoiceStudio/issues">
          VoiceStudio issues
        </ExternalLink>
      </div>
    </Note>
  );

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Voice"
        description="VoiceStudio runs separately on this machine. CAERA uses its loopback API for spoken replies and push-to-talk transcription, never a hosted voice service."
      />

      {voice.error ? (
        <Note tone="warn">
          Voice settings could not be read: {voice.error.message} The current node status is shown
          below; fields unlock when the local node is reachable.
        </Note>
      ) : null}

      <Panel>
        <PanelHeader
          title="VoiceStudio"
          description="The local voice service CAERA uses for speech output."
          action={<Chip tone={statusTone(status?.state)}>{statusLabel(status?.state)}</Chip>}
        />
        <RowGroup>
          <SettingRow label="Status" description={status?.detail ?? 'The node has not reported voice state yet.'}>
            <span className="font-mono text-[10.5px] text-ink-2">{status?.state ?? 'unknown'}</span>
          </SettingRow>
          <SettingRow label="Version" description="Reported by the local /health endpoint.">
            <span className="font-mono text-[10.5px] text-ink-3">{status?.version ?? '—'}</span>
          </SettingRow>
          <SettingRow label="Device" description="The compute device VoiceStudio reports.">
            <span className="font-mono text-[10.5px] text-ink-3">{status?.device ?? '—'}</span>
          </SettingRow>
          <SettingRow
            label="API contract"
            description="Read from VoiceStudio's own /openapi.json before any speech request."
          >
            <span className="font-mono text-[10.5px] text-ink-3">
              {status?.contract.state === 'verified'
                ? `OpenAPI ${status.contract.openapiVersion ?? ''} verified`
                : status?.contract.state ?? 'unknown'}
            </span>
          </SettingRow>
          <SettingRow label="Voices" description="Profiles, presets and OpenAI-compatible aliases reported by VoiceStudio.">
            <span className="font-mono text-[10.5px] text-ink-3">
              {status?.voiceCount === null || status?.voiceCount === undefined
                ? '—'
                : `${status.voiceCount} available`}
            </span>
          </SettingRow>
          <SettingRow
            label="Transcription"
            description={
              status?.transcription.detail ??
              'CAERA checks whether this VoiceStudio build documents POST /v1/audio/transcriptions.'
            }
          >
            <span className="font-mono text-[10.5px] text-ink-2">
              {status?.transcription.state ?? 'unknown'}
            </span>
          </SettingRow>
          <SettingRow
            label="Input mode"
            description="Push-to-talk is the only capture model in this build. Nothing listens in the background and no wake word is active."
          >
            <span className="font-mono text-[10.5px] text-ink-3">hold to talk</span>
          </SettingRow>
          <SettingRow label="Last checked">
            <span className="font-mono text-[10px] text-ink-3">
              {status ? formatRelative(status.checkedAt) : '—'}
            </span>
          </SettingRow>
        </RowGroup>

        <div className="space-y-3 border-t border-line px-4 py-3.5">
          <TextField
            label="Service address"
            value={url}
            maxLength={200}
            placeholder="http://localhost:3900"
            disabled={!settings || voice.saving}
            onChange={(next) => {
              setUrl(next);
              markDirty();
            }}
            hint="Loopback only: localhost, 127.0.0.1 or ::1. Paths and credentials are rejected."
            className="max-w-[420px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              icon="check"
              disabled={!settings || voice.saving || !url.trim()}
              onClick={() => void save({ url })}
            >
              {voice.saving ? 'Checking…' : 'Save address & check'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              disabled={!settings || voice.checking || voice.saving}
              onClick={() => void check()}
            >
              {voice.checking ? 'Checking…' : 'Check again'}
            </Button>
          </div>
          <p className="text-[11px] leading-[1.6] text-ink-3">
            CAERA asks VoiceStudio for <span className="font-mono text-[10px]">/health</span> and{' '}
            <span className="font-mono text-[10px]">/openapi.json</span> before listing voices or
            generating speech. Nothing is guessed from a version number.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Service lifecycle"
          description="CAERA can launch the documented headless backend. It never opens the desktop GUI, and it never stops a process it did not start."
          action={
            <Chip tone={lifecycleTone(status?.lifecycle.phase)}>
              {lifecycleLabel(status?.lifecycle.phase)}
            </Chip>
          }
        />
        <RowGroup>
          <SettingRow
            label="Process"
            description={
              status?.lifecycle.detail ??
              'CAERA has not checked whether it can manage a VoiceStudio process yet.'
            }
          >
            <span className="font-mono text-[10.5px] text-ink-2">
              {status?.lifecycle.managed
                ? `managed · PID ${status.lifecycle.pid ?? '—'}`
                : status?.lifecycle.phase ?? 'unknown'}
            </span>
          </SettingRow>
          <SettingRow
            label="Start automatically"
            description="Start the headless service when it is needed instead of requiring you to launch it first."
          >
            <Switch
              label="Start automatically"
              checked={autoStart}
              disabled={!settings || voice.saving}
              onChange={(next) => {
                setAutoStart(next);
                markDirty();
              }}
            />
          </SettingRow>
          <SettingRow
            label="When to start"
            description="With CAERA starts it during node boot. First use waits until speech output or push-to-talk needs it."
          >
            <SegmentedControl<VoiceStartMode>
              label="When to start"
              size="sm"
              value={startMode}
              onChange={(next) => {
                setStartMode(next);
                markDirty();
              }}
              options={[
                { value: 'startup', label: 'With CAERA' },
                { value: 'on-demand', label: 'First use' },
              ]}
            />
          </SettingRow>
          <SettingRow
            label="VoiceStudio source folder"
            description="A prepared checkout with backend/main.py and scripts/dev-backend.mjs. CAERA runs its documented bun run dev:api launcher from this folder."
          >
            <TextField
              label="VoiceStudio source folder"
              hideLabel
              value={voiceStudioDir}
              maxLength={500}
              placeholder="D:\\VoiceStudio"
              disabled={!settings || voice.saving}
              onChange={(next) => {
                setVoiceStudioDir(next);
                markDirty();
              }}
              hint={
                status?.lifecycle.launcher === 'command'
                  ? 'VOICESTUDIO_LAUNCH_CMD is set and takes precedence over this folder.'
                  : 'Absolute path. Leave empty to use the configured environment default. Only needed for auto-start; an already-running service is left alone.'
              }
              className="max-w-[420px]"
            />
          </SettingRow>
        </RowGroup>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3.5">
          <Button
            size="sm"
            variant="primary"
            icon="refresh"
            disabled={!status?.lifecycle.canStart || serviceBusy || voice.saving}
            onClick={() => void startService()}
          >
            {serviceBusy || status?.lifecycle.phase === 'starting' ? 'Starting…' : 'Start service'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="stop"
            disabled={!status?.lifecycle.canStop || serviceBusy}
            onClick={() => void stopService()}
          >
            Stop service
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!dirty || voice.saving}
            onClick={() => void save()}
          >
            Save service settings
          </Button>
        </div>
        <p className="px-4 pb-3.5 text-[11px] leading-[1.6] text-ink-3">
          CAERA starts the backend with <span className="font-mono text-[10px]">bun run dev:api</span>{' '}
          for a source checkout. A documented headless setup can instead set{' '}
          <span className="font-mono text-[10px]">VOICESTUDIO_LAUNCH_CMD</span>. CAERA tracks the
          exact child process and stops only that process when asked or when CAERA exits.
        </p>
      </Panel>

      {!connected && status?.lifecycle.phase !== 'starting' ? troubleshooting : null}

      <Panel>
        <PanelHeader
          title="Speaking"
          description="Choose a voice and how replies should be read."
          action={<Chip tone={dirty ? 'accent' : 'neutral'}>{dirty ? 'Unsaved' : 'Saved'}</Chip>}
        />
        <RowGroup>
          <SettingRow
            label="Enable voice output"
            description="Shows a speak control on assistant replies. Text chat is unaffected when voice is off."
          >
            <Switch
              label="Enable voice output"
              checked={enabled}
              disabled={!settings}
              onChange={(next) => {
                setEnabled(next);
                if (!next) stopVoicePlayback();
                markDirty();
              }}
            />
          </SettingRow>
          <SettingRow
            label="Read new replies aloud"
            description="Automatically speaks each completed assistant reply. Your browser may ask you to allow audio."
          >
            <Switch
              label="Read new replies aloud"
              checked={autoSpeak}
              disabled={!settings || !enabled}
              onChange={(next) => {
                setAutoSpeak(next);
                markDirty();
              }}
            />
          </SettingRow>
          <SettingRow
            label="Voice"
            description="Profiles are your own cloned or designed voices in VoiceStudio. Aliases map to the active engine default."
          >
            <div className="flex items-center gap-2">
              <SelectField
                label="Voice"
                hideLabel
                value={voiceId}
                disabled={!settings || !connected || voices.length === 0}
                options={options}
                onChange={(next) => {
                  setVoiceId(next);
                  markDirty();
                }}
                className="w-[240px]"
              />
              <Button
                size="sm"
                variant="ghost"
                icon="refresh"
                disabled={voice.checking || !settings}
                onClick={() => void check()}
                title="Refresh the VoiceStudio voice list"
              >
                Refresh
              </Button>
            </div>
          </SettingRow>
          <SettingRow
            label="Speed"
            description="Applies to newly generated speech. VoiceStudio accepts 0.25–4; this control stays in a natural range."
          >
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={speed}
                disabled={!settings}
                aria-label="Speech speed"
                onChange={(event) => {
                  setSpeed(Number(event.target.value));
                  markDirty();
                }}
                className="h-1 w-[170px] accent-[var(--c-accent)]"
              />
              <span className="w-10 text-right font-mono text-[10.5px] text-ink-3">
                {speed.toFixed(2)}×
              </span>
            </div>
          </SettingRow>
          <SettingRow
            label="Audio format"
            description="MP3 is the default. WAV is uncompressed and larger; both are requested from VoiceStudio."
          >
            <SegmentedControl<VoiceFormat>
              label="Audio format"
              size="sm"
              value={format}
              onChange={(next) => {
                setFormat(next);
                markDirty();
              }}
              options={[
                { value: 'mp3', label: 'MP3' },
                { value: 'wav', label: 'WAV' },
              ]}
            />
          </SettingRow>
        </RowGroup>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!settings || voice.saving || !dirty}
              onClick={() => void save()}
            >
              {voice.saving ? 'Saving…' : 'Save voice settings'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="volume"
              disabled={!settings || !connected || voice.saving || playback.status === 'generating'}
              onClick={() => void runTest()}
            >
              {playback.status === 'generating' && playback.messageId === null
                ? 'Generating…'
                : 'Test voice'}
            </Button>
            {playback.status !== 'idle' ? (
              <Button size="sm" variant="ghost" icon="stop" onClick={stopVoicePlayback}>
                Stop audio
              </Button>
            ) : null}
          </div>
          <span className="font-mono text-[10px] text-ink-3">
            {playback.status === 'playing'
              ? 'playing test audio'
              : playback.status === 'generating'
                ? 'generating audio'
                : 'audio idle'}
          </span>
        </div>
      </Panel>

      {catalog?.error ? (
        <Note tone="warn">
          VoiceStudio is running, but its voice list could not be read: {catalog.error} Speech may
          still work with the default voice.
        </Note>
      ) : null}

      {connected && catalog && catalog.voices.length === 0 && !catalog.error ? (
        <Note>
          VoiceStudio reports no voice profiles yet. The default engine voice is still available; add
          profiles in VoiceStudio to pick a specific voice here.
        </Note>
      ) : null}

      <Panel>
        <PanelHeader
          title="Local, private, licensed separately"
          description="VoiceStudio is a separate application with its own licence and model inventory."
        />
        <div className="space-y-2.5 px-4 py-3.5 text-[11.5px] leading-[1.65] text-ink-3">
          <p>
            CAERA sends reply text only to the loopback VoiceStudio API. Generated audio is returned
            to this window as a temporary blob; CAERA does not store audio or log spoken text. No
            installer, model weight or voice sample is bundled with CAERA.
          </p>
          <p>
            VoiceStudio is licensed under{' '}
            <ExternalLink href="https://www.gnu.org/licenses/agpl-3.0.html">AGPL-3.0</ExternalLink>
            . Model weights, voices and generated output have their own licences, shown per model in
            VoiceStudio&apos;s Model Manager. Clone or design a voice only with the speaker&apos;s
            permission.
          </p>
          <p>
            <ExternalLink href="https://github.com/debpalash/VoiceStudio">VoiceStudio source</ExternalLink>
            {' · '}
            <ExternalLink href="https://voicestudio.sh/download">Official download</ExternalLink>
            {' · '}
            <ExternalLink href="https://github.com/debpalash/VoiceStudio/issues">Report an issue</ExternalLink>
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Push-to-talk input"
          description="Hold the microphone in the command deck, speak, and release."
        />
        <div className="space-y-2.5 px-4 py-3.5 text-[11.5px] leading-[1.65] text-ink-3">
          <p>
            The browser records a short clip, converts it to 16 kHz mono WAV and posts it to the
            local CAERA node. The node forwards it to VoiceStudio's{' '}
            <span className="font-mono text-[10px]">POST /v1/audio/transcriptions</span>. The
            transcript is added to the thread and sent to the selected model; a spoken turn is read aloud when
            voice output is enabled.
          </p>
          <p>
            CAERA does not fall back to the browser Web Speech API. That API can send microphone
            audio to the browser vendor, so it would not be a local pipeline. Recording stops at 60
            seconds, releasing sends immediately, and releasing while the permission prompt is open
            cancels cleanly.
          </p>
          <p>
            Transcription is independent of speech output. If this VoiceStudio build lacks an ASR
            model, push-to-talk reports it and text chat keeps working. Microphone audio is never
            written to the CAERA database and transcript text is not logged.
          </p>
        </div>
      </Panel>
    </div>
  );
}
