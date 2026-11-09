import { useEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { VoiceTranscriptionStatus } from '@shared';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { StatusDot } from '@/components/ui/Indicators';
import type { PushToTalk } from '@/hooks/usePushToTalk';
import { cn } from '@/lib/cn';
import { pluralize } from '@/lib/format';
import type { ApiRequestError } from '@/services/api';
import type { VoicePlaybackStatus } from '@/services/voicePlayback';

type ModelState = 'not-configured' | 'configured' | 'connected' | 'error' | 'unknown';
type VoiceState = 'ready' | 'disabled' | 'unavailable' | 'unknown';

export interface PushToTalkControls {
  status: PushToTalk['status'];
  level: number;
  durationMs: number;
  error: PushToTalk['error'];
  supported: boolean;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  onClearError: () => void;
}

export interface CommandDockProps {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  onStop: () => void;
  pending: boolean;
  offline: boolean;
  modelState: ModelState;
  voiceState: VoiceState;
  voiceDetail?: string;
  voiceName?: string | null;
  voicePlayback: VoicePlaybackStatus;
  targetTitle: string | null;
  messageCount: number;
  pushToTalk: PushToTalkControls;
  transcribing: boolean;
  transcript: string | null;
  voiceError: ApiRequestError | null;
  transcription: VoiceTranscriptionStatus | null;
  muted: boolean;
  interrupted: boolean;
  onOpenProvider: () => void;
  onOpenVoiceSettings: () => void;
  onStopSpeaking: () => void;
  onInterrupt: () => void;
  onToggleMute: () => void;
  onDismissVoiceError: () => void;
  onDismissInterrupted: () => void;
  onCancelTranscription: () => void;
  onRecheckVoice: () => void;
  onRetryConnection: () => void;
  onUnavailable: (feature: string) => void;
  modelPicker?: ReactNode;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

const LEVEL_BARS = Array.from({ length: 18 }, (_, index) => index);

function voiceTone(state: VoiceState): 'online' | 'pending' | 'muted' {
  if (state === 'ready') return 'online';
  if (state === 'unknown') return 'pending';
  return 'muted';
}

/** A short bar profile shaped by the analyser's real level, not a timer. */
function levelBarHeight(level: number, index: number): number {
  const shape = 0.35 + Math.abs(Math.sin((index + 1) * 1.7)) * 0.65;
  return Math.max(2, Math.round(level * 22 * shape));
}

export function CommandDock({
  value,
  onChange,
  onSend,
  onStop,
  pending,
  offline,
  modelState,
  voiceState,
  voiceDetail,
  voiceName,
  voicePlayback,
  targetTitle,
  messageCount,
  pushToTalk,
  transcribing,
  transcript,
  voiceError,
  transcription,
  muted,
  interrupted,
  onOpenProvider,
  onOpenVoiceSettings,
  onStopSpeaking,
  onInterrupt,
  onToggleMute,
  onDismissVoiceError,
  onDismissInterrupted,
  onCancelTranscription,
  onRecheckVoice,
  onRetryConnection,
  onUnavailable,
  modelPicker,
  inputRef,
}: CommandDockProps): React.JSX.Element {
  const [voiceOpen, setVoiceOpen] = useState(false);

  const {
    onStart: startCapture,
    onStop: stopCapture,
    onCancel: cancelCapture,
    onClearError: clearCaptureError,
  } = pushToTalk;
  const requesting = pushToTalk.status === 'requesting';
  const recording = pushToTalk.status === 'recording';
  const encoding = pushToTalk.status === 'encoding';
  const capturing = requesting || recording;
  const captureError = pushToTalk.error;
  const playbackActive = voicePlayback !== 'idle';

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 170)}px`;
  }, [value, inputRef]);

  useEffect(() => {
    if (!voiceOpen) return;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('[data-voice-root]')) setVoiceOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setVoiceOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [voiceOpen]);

  // A push-to-talk release can land outside the button. Ending capture on the
  // window pointer release keeps the interaction reliable without extra clicks.
  useEffect(() => {
    if (!capturing) return;

    const release = (): void => stopCapture();
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [capturing, stopCapture]);

  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelCapture();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [capturing, cancelCapture]);

  const canSend = value.trim().length > 0 && !pending && !offline;
  const micBlocked = offline || !pushToTalk.supported;
  const micUnavailableReason = offline
    ? 'The local node is offline'
    : !pushToTalk.supported
      ? 'This browser cannot capture microphone audio'
      : null;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  const beginPushToTalk = (): void => {
    if (micBlocked || transcribing) return;
    clearCaptureError();
    startCapture();
  };

  const micDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    beginPushToTalk();
  };

  const micKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.repeat) return;
    beginPushToTalk();
  };

  const micKeyUp = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    stopCapture();
  };

  const voiceLabel =
    voiceState === 'ready'
      ? 'Linked'
      : voiceState === 'disabled'
        ? 'Output off'
        : voiceState === 'unknown'
          ? 'Checking'
          : 'Unavailable';

  const modelLabel =
    modelState === 'connected'
      ? 'Model ready'
      : modelState === 'configured'
        ? 'Model configured'
        : modelState === 'error'
          ? 'Model fault'
          : modelState === 'not-configured'
            ? 'No model'
            : 'Model unknown';

  const micLabel = recording
    ? 'Recording. Release to transcribe.'
    : requesting
      ? 'Waiting for microphone permission.'
      : transcribing
        ? 'Transcribing the recording.'
        : 'Hold to talk. Release to transcribe.';

  const transcriptionLabel =
    transcription?.state === 'ready'
      ? 'Available'
      : transcription?.state === 'unsupported'
        ? 'Unsupported'
        : 'Unknown';

  const captureDescription = recording
    ? 'Capturing microphone audio on this machine.'
    : requesting
      ? 'The browser is waiting for microphone permission.'
      : encoding
        ? 'Preparing the recording as 16 kHz mono WAV.'
        : transcribing
          ? 'Sending the recording to the local node and VoiceStudio.'
          : captureError
            ? captureError.message
            : micUnavailableReason ?? 'Ready for push-to-talk.';

  const outputDescription =
    voiceState === 'ready'
      ? voiceDetail || `${voiceName ?? 'VoiceStudio'} is ready to read replies aloud.`
      : voiceState === 'disabled'
        ? 'Voice output is switched off. Enable it in voice settings to hear spoken replies.'
        : voiceState === 'unavailable'
          ? voiceDetail || 'VoiceStudio is not reachable at its configured address.'
          : 'Checking the VoiceStudio service on this machine.';

  const stripError = voiceError ?? captureError;

  const voiceStrip = stripError ? (
    <div className="voice-strip" data-tone="danger" role="alert">
      <Icon name="warning" size={13} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p>{stripError.message}</p>
        {'hint' in stripError && stripError.hint ? (
          <p className="voice-strip-hint">{stripError.hint}</p>
        ) : null}
      </div>
      <button
        type="button"
        className="voice-strip-action"
        onClick={() => {
          clearCaptureError();
          onDismissVoiceError();
        }}
      >
        Dismiss
      </button>
    </div>
  ) : requesting ? (
    <div className="voice-strip" data-tone="accent" role="status">
      <span className="voice-spinner" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p>Waiting for microphone permission</p>
        <p className="voice-strip-hint">Allow the microphone prompt, then speak while holding.</p>
      </div>
      <button type="button" className="voice-strip-action" onClick={cancelCapture}>
        Cancel
      </button>
    </div>
  ) : recording ? (
    <div className="voice-strip" data-tone="live" role="status">
      <span className="voice-live-dot" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="voice-strip-line">
          <span>Listening</span>
          <span className="voice-strip-meter">
            {LEVEL_BARS.map((bar) => (
              <span key={bar} style={{ height: `${levelBarHeight(pushToTalk.level, bar)}px` }} />
            ))}
          </span>
          <span className="font-mono text-[10px] text-ink-3">
            {(pushToTalk.durationMs / 1000).toFixed(1)}s / 60s
          </span>
        </p>
        <p className="voice-strip-hint">Release to transcribe · Escape cancels</p>
      </div>
    </div>
  ) : encoding ? (
    <div className="voice-strip" data-tone="accent" role="status">
      <span className="voice-spinner" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p>Encoding the recording</p>
      </div>
    </div>
  ) : transcribing ? (
    <div className="voice-strip" data-tone="accent" role="status">
      <span className="voice-spinner" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p>Transcribing through VoiceStudio</p>
        <p className="voice-strip-hint">The audio stays on this machine.</p>
      </div>
      <button type="button" className="voice-strip-action" onClick={onCancelTranscription}>
        Cancel
      </button>
    </div>
  ) : interrupted ? (
    <div className="voice-strip" data-tone="neutral" role="status">
      <Icon name="stop" size={12} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p>Response interrupted</p>
        <p className="voice-strip-hint">Hold the microphone to continue by voice, or type below.</p>
      </div>
      <button type="button" className="voice-strip-action" onClick={onDismissInterrupted}>
        Dismiss
      </button>
    </div>
  ) : transcript ? (
    <div className="voice-strip" data-tone="neutral" role="status">
      <Icon name="mic" size={12} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="voice-strip-transcript">{transcript}</p>
      </div>
      <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4">Heard</span>
    </div>
  ) : null;

  return (
    <div className="dock-zone">
      {offline ? (
        <div className="mx-auto mb-2 max-w-[1120px]">
          <div className="dock-offline">
            <p>
              Local node unreachable. Start it with{' '}
              <span className="font-mono text-[10px] text-ink">npm run dev</span>.
            </p>
            <button
              type="button"
              onClick={onRetryConnection}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-2 transition-colors hover:text-ink"
            >
              <Icon name="refresh" size={10} />
              Reconnect
            </button>
          </div>
        </div>
      ) : null}

      <div className="dock-shell" data-offline={offline ? 'true' : undefined}>
        {voiceOpen ? (
          <div
            id="voice-channel"
            className="voice-popover"
            role="dialog"
            aria-label="Voice channel"
            data-voice-root="true"
          >
            <div className="voice-popover-head">
              <div>
                <p className="rail-title">Voice channel</p>
                <h3>VoiceStudio</h3>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[10.5px] text-ink-3">
                <StatusDot tone={voiceTone(voiceState)} />
                {voiceLabel}
              </span>
            </div>

            <div
              className="voice-preview"
              data-active={playbackActive || capturing ? 'true' : undefined}
              aria-hidden="true"
            >
              <div className="voice-preview-wave">
                {LEVEL_BARS.map((bar) => (
                  <span
                    key={bar}
                    style={{
                      height: recording ? `${levelBarHeight(pushToTalk.level, bar)}px` : '2px',
                    }}
                  />
                ))}
              </div>
              <span className="text-[10px] text-ink-4">
                {recording || requesting
                  ? 'Capturing input'
                  : transcribing
                    ? 'Transcribing'
                    : voicePlayback === 'playing'
                      ? 'Playing locally'
                      : voicePlayback === 'generating'
                        ? 'Generating audio'
                        : 'Audio idle'}
              </span>
            </div>

            <p className="text-[10.5px] leading-[1.6] text-ink-3">{captureDescription}</p>
            <p className="mt-1.5 text-[10.5px] leading-[1.6] text-ink-3">{outputDescription}</p>

            <dl className="voice-rows">
              <div>
                <dt>Microphone</dt>
                <dd>
                  {micBlocked
                    ? 'unavailable'
                    : captureError
                      ? captureError.code === 'permission-denied'
                        ? 'denied'
                        : 'error'
                      : recording
                        ? 'capturing'
                        : requesting
                          ? 'permission'
                          : encoding
                            ? 'encoding'
                            : transcribing
                              ? 'transcribing'
                              : 'ready'}
                </dd>
              </div>
              <div>
                <dt>Transcription</dt>
                <dd>{transcribing ? 'running' : transcriptionLabel.toLowerCase()}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>push-to-talk</dd>
              </div>
              <div>
                <dt>Voice</dt>
                <dd>{voiceName ?? 'VoiceStudio default'}</dd>
              </div>
              <div>
                <dt>Playback</dt>
                <dd>{voicePlayback === 'idle' ? 'idle' : voicePlayback}</dd>
              </div>
              <div>
                <dt>Replies</dt>
                <dd>{muted ? 'muted' : voiceState === 'disabled' ? 'off' : 'on'}</dd>
              </div>
            </dl>

            {transcript ? (
              <div className="voice-last-transcript">
                <p className="rail-title">Last transcript</p>
                <p>{transcript}</p>
              </div>
            ) : null}

            <div className="voice-actions">
              {playbackActive ? (
                <Button size="sm" variant="secondary" icon="stop" onClick={onStopSpeaking}>
                  Stop audio
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                icon={muted ? 'volume' : 'volumeOff'}
                onClick={onToggleMute}
              >
                {muted ? 'Unmute replies' : 'Mute replies'}
              </Button>
              <Button size="sm" variant="ghost" icon="refresh" onClick={onRecheckVoice}>
                Recheck
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="settings"
                onClick={() => {
                  setVoiceOpen(false);
                  onOpenVoiceSettings();
                }}
              >
                Open settings
              </Button>
            </div>

            <p className="mt-2.5 text-[9.5px] leading-[1.55] text-ink-4">
              Hold the microphone to talk and release to transcribe. Nothing listens in the
              background, and no wake word is active.
            </p>
          </div>
        ) : null}

        {voiceStrip}

        <div className="dock-main">
          <div className="dock-voice" data-voice-root="true">
            <button
              type="button"
              className="voice-mic"
              data-recording={recording ? 'true' : undefined}
              data-pending={requesting || transcribing ? 'true' : undefined}
              aria-pressed={recording}
              aria-label={micLabel}
              aria-describedby={micBlocked ? 'voice-mic-note' : undefined}
              title={micUnavailableReason ?? micLabel}
              disabled={micBlocked || transcribing}
              onPointerDown={micDown}
              onKeyDown={micKeyDown}
              onKeyUp={micKeyUp}
              onContextMenu={(event) => event.preventDefault()}
            >
              <Icon name={recording ? 'waveform' : 'mic'} size={16} />
            </button>
            <button
              type="button"
              className="voice-channel-toggle"
              aria-expanded={voiceOpen}
              aria-controls="voice-channel"
              aria-label={`Voice channel. VoiceStudio is ${voiceLabel.toLowerCase()}.`}
              title={`Voice channel — ${voiceLabel.toLowerCase()}`}
              onClick={() => setVoiceOpen((open) => !open)}
            >
              <Icon name="chevronDown" size={9} />
            </button>
            {micBlocked ? (
              <span id="voice-mic-note" className="sr-only">
                {micUnavailableReason}
              </span>
            ) : null}
          </div>

          <div className="dock-input-wrap">
            <span className="dock-prompt" aria-hidden="true">
              &gt;
            </span>
            <textarea
              ref={inputRef}
              value={value}
              rows={1}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onKeyDown}
              aria-label="Message CAERA"
              placeholder={
                offline
                  ? 'Local node offline'
                  : recording
                    ? 'Listening — release to send'
                    : transcribing
                      ? 'Transcribing your recording'
                      : 'Message CAERA'
              }
              className="dock-textarea"
            />
          </div>

          <div className="dock-actions">
            <button
              type="button"
              className="dock-icon"
              onClick={() => onUnavailable('Attachments')}
              aria-label="Attach a file"
              title="Attachments are not implemented"
            >
              <Icon name="paperclip" size={14} />
            </button>

            {pending ? (
              <button
                type="button"
                className="dock-send"
                data-stop="true"
                onClick={onStop}
                title="Stop generating"
              >
                <Icon name="stop" size={11} />
                Stop
              </button>
            ) : (
              <button
                type="button"
                className={cn('dock-send')}
                onClick={onSend}
                disabled={!canSend}
                title={
                  offline
                    ? 'The local node is offline'
                    : !value.trim()
                      ? 'Write a command first'
                      : 'Send with Enter'
                }
              >
                <Icon name="send" size={12} />
                Send
              </button>
            )}
          </div>
        </div>

        {pending || playbackActive ? (
          <div className="dock-interrupt">
            <span>
              {pending ? 'CAERA is still working.' : 'CAERA is speaking.'} Interrupting keeps what
              has already been written.
            </span>
            <button type="button" onClick={onInterrupt}>
              <Icon name="stop" size={10} />
              Interrupt
            </button>
          </div>
        ) : null}

        {modelPicker ? (
          <div className="border-t border-line/70 px-3 py-2">{modelPicker}</div>
        ) : null}

        <div className="dock-foot">
          <div className="dock-foot-left">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="shield" size={10} />
              Stored locally
            </span>
            <span className="dock-foot-sep" aria-hidden="true" />
            <strong title={targetTitle ?? 'New thread'}>{targetTitle ?? 'New thread'}</strong>
            {messageCount > 0 ? <span>{pluralize(messageCount, 'message')}</span> : null}
          </div>
          <div className="dock-foot-right">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={voiceTone(voiceState)} />
              {voiceState === 'ready'
                ? muted
                  ? 'Voice muted'
                  : 'Voice ready'
                : voiceState === 'disabled'
                  ? 'Voice off'
                  : voiceState === 'unknown'
                    ? 'Voice unknown'
                    : 'Voice unavailable'}
            </span>
            <span className="dock-foot-sep" aria-hidden="true" />
            <button
              type="button"
              onClick={onOpenProvider}
              title="Open Models & usage settings"
            >
              {modelLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
