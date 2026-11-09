import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Message, NoticeActionId, TurnStreamEvent } from '@shared';
import { Icon } from '@/components/icons/Icon';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { CommandDock } from '@/components/layout/CommandDock';
import { MemoryEditor } from '@/components/memory/MemoryEditor';
import { OpsPanel } from '@/components/layout/OpsPanel';
import { SystemsPanel } from '@/components/layout/SystemsPanel';
import { ThreadPanel } from '@/components/layout/ThreadPanel';
import { Button } from '@/components/ui/Button';
import { Drawer, Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { Visualizer } from '@/components/visualizer/Visualizer';
import { VISUALIZER_CONFIG } from '@/components/visualizer/state';
import { useAppChrome } from '@/contexts/AppChromeContext';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useConversation } from '@/hooks/useConversation';
import { useAi } from '@/hooks/useAi';
import { useInstrumentState } from '@/hooks/useInstrumentState';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePushToTalk } from '@/hooks/usePushToTalk';
import { useVoiceSettings } from '@/hooks/useVoiceSettings';
import { notifyConversationsChanged } from '@/lib/appEvents';
import { pluralize } from '@/lib/format';
import { ApiRequestError, api, isAbortError, toApiError } from '@/services/api';
import {
  getVoicePlaybackState,
  speakMessage as speakVoice,
  stopVoicePlayback,
  subscribeVoicePlayback,
  type VoicePlaybackState,
} from '@/services/voicePlayback';

type SideTab = 'ops' | 'thread';
type TurnSource = 'text' | 'voice';

const MAX_CAPTURE_MS = 60_000;

interface StreamingReply {
  message: Message;
  stopped: boolean;
}

export function WorkspacePage(): React.JSX.Element {
  const { conversationId } = useParams<{ conversationId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { preferences, update } = usePreferences();
  const node = useLocalNode();
  const { openHistory } = useAppChrome();
  const { push } = useToast();

  const { conversation, loading, error, setConversation, reload } = useConversation(conversationId);
  const voice = useVoiceSettings();
  const pushToTalk = usePushToTalk();
  const ai = useAi();

  const isRightInline = useMediaQuery('(min-width: 1024px)');
  const isSystemsInline = useMediaQuery('(min-width: 1360px)');

  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState<ApiRequestError | null>(null);
  const [streaming, setStreaming] = useState<StreamingReply | null>(null);
  const [value, setValue] = useState('');
  const [sideTab, setSideTab] = useState<SideTab>(conversationId ? 'thread' : 'ops');
  const [systemsOpen, setSystemsOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [capture, setCapture] = useState<{ message: Message } | null>(null);
  const [playback, setPlayback] = useState<VoicePlaybackState>(getVoicePlaybackState);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<ApiRequestError | null>(null);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceInterrupted, setVoiceInterrupted] = useState(false);
  const [modelChoice, setModelChoice] = useState('auto');
  const [rememberingModel, setRememberingModel] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef<StreamingReply | null>(null);
  const voiceSettingsRef = useRef(voice.settings);
  const activeTargetRef = useRef<string | null>(null);
  const stopReasonRef = useRef<'user' | 'navigation' | null>(null);
  const reloadTimerRef = useRef<number | null>(null);
  const transcribeRef = useRef<AbortController | null>(null);
  const voiceMutedRef = useRef(false);
  const stopListeningRef = useRef<() => void>(() => undefined);
  const modelInitializedRef = useRef(false);

  const focusRequest = (location.state as { focusComposerAt?: number } | null)?.focusComposerAt;
  const voicePhase =
    pushToTalk.status === 'recording' || pushToTalk.status === 'requesting'
      ? 'listening'
      : pushToTalk.status === 'encoding'
        ? 'thinking'
        : transcribing
          ? 'transcribing'
          : voiceInterrupted
            ? 'interrupted'
            : null;
  const instrument = useInstrumentState({
    busy: pending,
    error: Boolean(sendError || voiceError || pushToTalk.error),
    speaking: playback.status === 'playing',
    phase: voicePhase,
  });
  const displayState = preferences.visualizerPreview ?? instrument;
  const config = VISUALIZER_CONFIG[displayState];
  const preview = Boolean(preferences.visualizerPreview);
  const modelConfigured =
    Boolean(ai.snapshot?.models.length) ||
    node.report?.provider.state === 'configured' ||
    node.report?.provider.state === 'connected';

  useEffect(() => {
    if (modelInitializedRef.current || !ai.snapshot) return;
    modelInitializedRef.current = true;
    setModelChoice(ai.snapshot.settings.defaultModel ?? 'auto');
  }, [ai.snapshot]);

  const rememberModel = async (): Promise<void> => {
    setRememberingModel(true);
    try {
      const result = await api.updateAiSettings({
        defaultModel: modelChoice === 'auto' ? null : modelChoice,
      });
      ai.setSnapshot(result.snapshot);
      push('Default model updated', {
        detail:
          modelChoice === 'auto'
            ? 'New turns use automatic routing.'
            : 'This model is now the default; the picker stays available for per-message overrides.',
        tone: 'success',
      });
    } catch (cause) {
      push('Could not save the default model', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setRememberingModel(false);
    }
  };

  const updateStreaming = useCallback(
    (updater: (current: StreamingReply | null) => StreamingReply | null) => {
      setStreaming((current) => {
        const next = updater(current);
        streamingRef.current = next;
        return next;
      });
    },
    [],
  );

  const scheduleReload = useCallback(
    (delay = 500) => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = window.setTimeout(() => {
        reload();
        notifyConversationsChanged();
      }, delay);
    },
    [reload],
  );

  const focusComposer = useCallback((): void => {
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const closeDelete = useCallback(() => setConfirmDelete(false), []);
  const closeSystems = useCallback(() => setSystemsOpen(false), []);
  const closeOps = useCallback(() => setOpsOpen(false), []);

  useEffect(() => {
    if (!focusRequest) return;
    focusComposer();
  }, [focusRequest, focusComposer]);

  useEffect(() => subscribeVoicePlayback(setPlayback), []);

  useEffect(() => {
    voiceSettingsRef.current = voice.settings;
  }, [voice.settings]);

  useEffect(() => {
    return () => stopVoicePlayback();
  }, []);

  useEffect(() => {
    stopVoicePlayback();
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    update({ lastConversationId: conversationId });
  }, [conversationId, update]);

  useEffect(() => {
    setSideTab(conversationId ? 'thread' : 'ops');
    setSystemsOpen(false);
    setOpsOpen(false);
  }, [conversationId]);

  useEffect(() => {
    if (isRightInline) setOpsOpen(false);
    if (isSystemsInline) setSystemsOpen(false);
  }, [isRightInline, isSystemsInline]);

  useEffect(() => {
    const target = activeTargetRef.current;
    if (abortRef.current && target && conversationId !== target) {
      stopReasonRef.current = 'navigation';
      abortRef.current.abort();
    }
    transcribeRef.current?.abort();
    pushToTalk.cancel();
  }, [conversationId]);

  useEffect(() => {
    if (!streaming?.stopped) return;
    if (conversation?.messages.some((message) => message.id === streaming.message.id)) {
      updateStreaming(() => null);
    }
  }, [conversation, streaming, updateStreaming]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      transcribeRef.current?.abort();
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      pushToTalk.cancel();
    };
  }, []);

  const autoSpeakReply = useCallback(
    (conversationIdForVoice: string, messageId: string, source: TurnSource) => {
      const settings = voiceSettingsRef.current;
      if (!settings?.configuration.enabled) return;
      // A spoken turn answers aloud even when automatic reply reading is off.
      if (!settings.configuration.autoSpeak && source !== 'voice') return;
      if (voiceMutedRef.current) return;
      if (node.report?.voice.state !== 'ready') return;

      void speakVoice({ conversationId: conversationIdForVoice, messageId }).catch((cause) => {
        const blocked =
          typeof cause === 'object' &&
          cause !== null &&
          'name' in cause &&
          (cause as { name?: string }).name === 'NotAllowedError';

        push(blocked ? 'Speech is ready but playback was blocked' : 'Automatic voice failed', {
          detail: blocked
            ? 'Press Speak reply on the message to start audio.'
            : toApiError(cause).message,
          tone: 'warning',
        });
      });
    },
    [node.report, push],
  );

  const sendMessage = async (
    contentOverride?: string,
    source: TurnSource = 'text',
  ): Promise<void> => {
    const content = (contentOverride ?? value).trim();
    if (!content || pending) return;

    stopVoicePlayback();
    setVoiceInterrupted(false);
    setVoiceError(null);
    if (source === 'text') setTranscript(null);
    setPending(true);
    setSendError(null);
    updateStreaming(() => null);
    const controller = new AbortController();
    abortRef.current = controller;
    stopReasonRef.current = null;

    let targetId = conversationId;
    let terminal = false;

    try {
      if (!targetId) {
        const created = await api.createConversation({}, controller.signal);
        targetId = created.conversation.id;
        setConversation(created.conversation);
        notifyConversationsChanged();
        activeTargetRef.current = targetId;
        navigate(`/c/${targetId}`, { replace: true });
      } else {
        activeTargetRef.current = targetId;
      }

      setValue('');
      setSideTab('thread');

      await api.streamTurn(targetId, content, {
        signal: controller.signal,
        ...(modelInitializedRef.current ? { model: modelChoice } : {}),
        onEvent: (event: TurnStreamEvent) => {
          if (controller.signal.aborted) return;

          switch (event.type) {
            case 'turn_started':
              setConversation(event.conversation);
              updateStreaming(() => ({
                message: {
                  id: event.assistantMessageId,
                  conversationId: event.conversation.id,
                  role: 'assistant',
                  kind: 'text',
                  content: '',
                  createdAt: new Date().toISOString(),
                },
                stopped: false,
              }));
              break;
            case 'assistant_delta':
              updateStreaming((current) =>
                current
                  ? {
                      ...current,
                      message: {
                        ...current.message,
                        content: current.message.content + event.text,
                      },
                    }
                  : current,
              );
              break;
            case 'assistant_done':
              terminal = true;
              setConversation(event.conversation);
              updateStreaming(() => null);
              notifyConversationsChanged();
              node.refresh();
              autoSpeakReply(event.conversation.id, event.message.id, source);
              break;
            case 'turn_error':
              terminal = true;
              if (event.conversation) setConversation(event.conversation);
              updateStreaming(() => null);
              setSendError(
                new ApiRequestError(event.error.message, {
                  code: event.error.code,
                  status: 0,
                  ...(event.error.hint ? { hint: event.error.hint } : {}),
                }),
              );
              notifyConversationsChanged();
              node.refresh();
              break;
          }
        },
      });

      if (!terminal && !controller.signal.aborted) {
        setSendError(
          new ApiRequestError('The reply stream ended before the assistant finished.', {
            code: 'STREAM_INTERRUPTED',
            status: 0,
            hint: 'Reload the thread to see any reply the node stored.',
          }),
        );
        scheduleReload(350);
      }
    } catch (cause) {
      if (isAbortError(cause)) {
        const active = streamingRef.current;
        if (stopReasonRef.current === 'navigation') {
          updateStreaming(() => null);
        } else if (active?.message.content.trim()) {
          updateStreaming((current) => (current ? { ...current, stopped: true } : null));
          push('Generation stopped', { detail: 'The partial reply is kept locally.' });
          scheduleReload(600);
        } else {
          updateStreaming(() => null);
          push('Generation stopped', { detail: 'No reply was written.' });
        }
      } else {
        const apiError = toApiError(cause);
        updateStreaming((current) =>
          current && current.message.content.trim() ? { ...current, stopped: true } : null,
        );
        setSendError(apiError);
        scheduleReload(400);
        push('Reply failed', { detail: apiError.message, tone: 'error' });
      }
    } finally {
      setPending(false);
      if (abortRef.current === controller) abortRef.current = null;
      if (activeTargetRef.current === targetId) activeTargetRef.current = null;
      stopReasonRef.current = null;
    }
  };

  const stop = (): void => {
    stopReasonRef.current = 'user';
    abortRef.current?.abort();
  };

  const cancelTranscription = useCallback((): void => {
    transcribeRef.current?.abort();
  }, []);

  /** Sends a finished push-to-talk WAV to the local node for VoiceStudio transcription. */
  const transcribeRecording = async (audio: Blob): Promise<void> => {
    const controller = new AbortController();
    transcribeRef.current = controller;
    setTranscribing(true);
    setVoiceError(null);

    try {
      const result = await api.transcribeVoice(audio, controller.signal);
      if (controller.signal.aborted) return;

      const text = result.text.trim();
      if (!text) {
        setVoiceError(
          new ApiRequestError('VoiceStudio returned an empty transcript.', {
            code: 'VOICE_EMPTY_TRANSCRIPT',
            status: 200,
            hint: 'Speak a little longer, then hold the microphone and try again.',
          }),
        );
        return;
      }

      setTranscript(text);
      await sendMessage(text, 'voice');
    } catch (cause) {
      if (isAbortError(cause)) return;
      const apiError = toApiError(cause);
      setVoiceError(apiError);
      push('Transcription failed', { detail: apiError.message, tone: 'error' });
    } finally {
      if (transcribeRef.current === controller) transcribeRef.current = null;
      setTranscribing(false);
    }
  };

  const stopListening = async (): Promise<void> => {
    const result = await pushToTalk.stop();
    if (!result) return;
    await transcribeRecording(result.audio);
  };

  /** Push-to-talk start also barges in on a reply that is speaking or generating. */
  const startListening = async (): Promise<void> => {
    if (transcribing) return;
    if (
      pushToTalk.status === 'requesting' ||
      pushToTalk.status === 'recording' ||
      pushToTalk.status === 'encoding'
    ) {
      return;
    }

    const wasActive = pending || getVoicePlaybackState().status !== 'idle';
    if (pending) stop();
    if (getVoicePlaybackState().status !== 'idle') stopVoicePlayback();

    setVoiceInterrupted(false);
    setTranscript(null);
    setVoiceError(null);
    setSendError(null);
    pushToTalk.clearError();

    // The hook reports permission and device errors itself; the strip surfaces them.
    const started = await pushToTalk.start();
    if (!started && wasActive) setVoiceInterrupted(true);
  };

  const interrupt = (): void => {
    const speaking = getVoicePlaybackState().status !== 'idle';
    if (pending) stop();
    if (speaking) stopVoicePlayback();
    if (pending || speaking) setVoiceInterrupted(true);
  };

  const stopSpeaking = (): void => {
    if (getVoicePlaybackState().status !== 'idle') setVoiceInterrupted(true);
    stopVoicePlayback();
  };

  const toggleMute = useCallback((): void => {
    setVoiceMuted((current) => {
      const next = !current;
      voiceMutedRef.current = next;
      if (next && getVoicePlaybackState().status !== 'idle') stopVoicePlayback();
      return next;
    });
  }, []);

  useEffect(() => {
    stopListeningRef.current = () => {
      void stopListening();
    };
  });

  useEffect(() => {
    if (pushToTalk.status !== 'recording') return;
    const timer = window.setTimeout(() => stopListeningRef.current(), MAX_CAPTURE_MS);
    return () => window.clearTimeout(timer);
  }, [pushToTalk.status]);

  const dismissError = useCallback(() => setSendError(null), []);
  const rememberMessage = useCallback((message: Message) => setCapture({ message }), []);

  const rename = async (title: string): Promise<void> => {
    if (!conversationId) return;
    try {
      const result = await api.renameConversation(conversationId, title);
      setConversation(result.conversation);
      notifyConversationsChanged();
      push('Conversation renamed');
    } catch (cause) {
      push('Could not rename', { detail: toApiError(cause).message, tone: 'error' });
    }
  };

  const remove = async (): Promise<void> => {
    if (!conversationId) return;
    setDeleting(true);
    try {
      await api.deleteConversation(conversationId);
      notifyConversationsChanged();
      setConfirmDelete(false);
      push('Conversation deleted', { detail: 'Removed from this device.', tone: 'success' });
      navigate('/');
    } catch (cause) {
      push('Could not delete', { detail: toApiError(cause).message, tone: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const onNoticeAction = (action: NoticeActionId): void => {
    switch (action) {
      case 'open-provider-settings':
        navigate('/settings/provider');
        break;
      case 'open-tools':
        navigate('/tools');
        break;
      case 'open-memory-settings':
        navigate('/settings/memory');
        break;
      case 'retry':
        reload();
        break;
    }
  };

  const usePrompt = (text: string): void => {
    setValue(text);
    focusComposer();
  };

  const startNewThread = (): void => {
    stopVoicePlayback();
    transcribeRef.current?.abort();
    pushToTalk.cancel();
    if (pending) {
      stopReasonRef.current = 'navigation';
      abortRef.current?.abort();
    }
    updateStreaming(() => null);
    setSendError(null);
    setVoiceError(null);
    setVoiceInterrupted(false);
    setTranscript(null);
    setValue('');
    setSideTab('ops');
    if (conversationId) {
      navigate('/', { state: { focusComposerAt: Date.now() } });
    } else {
      focusComposer();
    }
  };

  const openOps = (): void => {
    setOpsOpen(true);
    setSystemsOpen(false);
  };

  const openSystems = (): void => {
    setSystemsOpen(true);
    setOpsOpen(false);
  };

  const offline = node.status === 'offline';
  const modelState: 'not-configured' | 'configured' | 'connected' | 'error' | 'unknown' =
    node.status !== 'online'
      ? 'unknown'
      : (node.report?.provider.state ?? 'not-configured');
  const voiceEnabled = voice.settings?.configuration.enabled ?? false;
  const voiceServiceReady = node.report?.voice.state === 'ready';
  const voiceState: 'ready' | 'disabled' | 'unavailable' | 'unknown' =
    node.status !== 'online'
      ? 'unknown'
      : voiceServiceReady
        ? voiceEnabled
          ? 'ready'
          : 'disabled'
        : 'unavailable';

  const speak = useCallback(
    (message: Message): void => {
      const config = voice.settings?.configuration;
      if (!config?.enabled) {
        push('Voice output is off', {
          detail: 'Enable it in Settings → Voice.',
          tone: 'warning',
        });
        return;
      }

      if (voiceMuted) {
        push('Replies are muted', {
          detail: 'Unmute replies from the voice channel in the command deck.',
          tone: 'warning',
        });
        return;
      }

      setVoiceInterrupted(false);

      if (node.report?.voice.state !== 'ready') {
        push('VoiceStudio is unavailable', {
          detail: node.report?.voice.detail ?? 'Start VoiceStudio, then check Settings → Voice.',
          tone: 'error',
        });
        return;
      }

      void speakVoice({ conversationId: message.conversationId, messageId: message.id }).catch(
        (cause) => {
          push('Voice playback failed', { detail: toApiError(cause).message, tone: 'error' });
        },
      );
    },
    [voice.settings, node.report, push, voiceMuted],
  );

  const voiceControls = voiceEnabled
    ? {
        enabled: true,
        ready: voiceServiceReady,
        playback,
        onSpeak: speak,
        onStop: stopSpeaking,
      }
    : undefined;

  const dock = (
    <CommandDock
      value={value}
      onChange={setValue}
      onSend={() => void sendMessage()}
      onStop={stop}
      pending={pending}
      offline={offline}
      modelState={modelState}
      voiceState={voiceState}
      voiceDetail={node.report?.voice.detail}
      voiceName={voice.settings?.configuration.voiceName ?? null}
      voicePlayback={playback.status}
      pushToTalk={{
        status: pushToTalk.status,
        level: pushToTalk.level,
        durationMs: pushToTalk.durationMs,
        error: pushToTalk.error,
        supported: pushToTalk.supported,
        onStart: () => {
          void startListening();
        },
        onStop: () => {
          void stopListening();
        },
        onCancel: pushToTalk.cancel,
        onClearError: pushToTalk.clearError,
      }}
      transcribing={transcribing}
      transcript={transcript}
      voiceError={voiceError}
      transcription={node.report?.voice.transcription ?? null}
      muted={voiceMuted}
      interrupted={voiceInterrupted}
      onToggleMute={toggleMute}
      onDismissVoiceError={() => {
        pushToTalk.clearError();
        setVoiceError(null);
      }}
      onDismissInterrupted={() => setVoiceInterrupted(false)}
      onCancelTranscription={cancelTranscription}
      onInterrupt={interrupt}
      onStopSpeaking={stopSpeaking}
      onRecheckVoice={() => {
        void voice
          .check()
          .then(() => node.refresh())
          .catch((cause) => {
            push('Voice check failed', { detail: toApiError(cause).message, tone: 'error' });
          });
      }}
      targetTitle={conversation?.title ?? null}
      messageCount={conversation?.messageCount ?? 0}
      modelPicker={
        <ModelPicker
          snapshot={ai.snapshot}
          value={modelChoice}
          onChange={setModelChoice}
          onRemember={() => void rememberModel()}
          onConfigure={() => navigate('/settings/provider')}
          disabled={pending}
          remembering={rememberingModel}
        />
      }
      onOpenProvider={() => navigate('/settings/provider')}
      onOpenVoiceSettings={() => navigate('/settings/voice')}
      onRetryConnection={node.refresh}
      onUnavailable={(feature) =>
        push(`${feature} are not implemented`, {
          detail:
            feature === 'Attachments'
              ? 'File attachments arrive with the tool runtime.'
              : 'This interface does not fake the capability.',
        })
      }
      inputRef={inputRef}
    />
  );

  const overlays = (
    <>
      <Drawer open={systemsOpen} onClose={closeSystems} label="Systems" side="left" width={304}>
        <div className="systems-drawer-body">
          <SystemsPanel onClose={closeSystems} />
        </div>
      </Drawer>

      <Drawer open={opsOpen} onClose={closeOps} label="Operations" side="right" width={366}>
        <div className="flex h-full min-h-0 flex-col">
          <OpsPanel
            conversation={conversation}
            pending={pending}
            sendError={sendError}
            onOpenThread={() => {
              setOpsOpen(false);
              if (!conversationId) focusComposer();
            }}
            onClose={closeOps}
          />
        </div>
      </Drawer>

      <Modal
        open={confirmDelete}
        onClose={closeDelete}
        label="Delete conversation"
        width={440}
      >
        <div className="px-4 py-4">
          <h2 className="text-[20px] font-medium leading-tight tracking-[-0.02em] text-ink">
            Delete this thread?
          </h2>
          <p className="mt-2 text-[12.5px] leading-[1.65] text-ink-3">
            “{conversation?.title}” and its {pluralize(conversation?.messageCount ?? 0, 'message')}{' '}
            will be removed from this device. This cannot be undone.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button size="sm" variant="ghost" onClick={closeDelete}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" disabled={deleting} onClick={() => void remove()}>
            {deleting ? 'Deleting…' : 'Delete thread'}
          </Button>
        </div>
      </Modal>

      <MemoryEditor
        open={Boolean(capture)}
        paused={node.report?.memory.state === 'paused'}
        defaultContent={capture ? capture.message.content.trim().slice(0, 2000) : ''}
        {...(capture
          ? {
              source: {
                conversationId: capture.message.conversationId,
                messageId: capture.message.id,
                excerpt: capture.message.content.trim().slice(0, 500),
                conversationTitle: conversation?.title ?? null,
              },
            }
          : {})}
        onClose={() => setCapture(null)}
        onSaved={() => {
          setCapture(null);
          node.refresh();
          push('Memory stored', {
            detail: 'Review or edit it on the Memory page.',
            tone: 'success',
          });
        }}
      />
    </>
  );

  if (!isRightInline && conversationId) {
    return (
      <>
        <div className="thread-workspace">
          <ThreadPanel
            narrow
            coreState={instrument}
            audioLevel={pushToTalk.status === 'recording' ? pushToTalk.level : undefined}
            conversation={conversation}
            loading={loading}
            loadError={error}
            pending={pending}
            sendError={sendError}
            streaming={streaming}
            {...(voiceControls ? { voice: voiceControls } : {})}
            onNoticeAction={onNoticeAction}
            onDismissError={dismissError}
            onOpenProviderSettings={() => navigate('/settings/provider')}
            onRetryLoad={reload}
            onRename={(title) => void rename(title)}
            onDelete={() => setConfirmDelete(true)}
            onOpenHistory={openHistory}
            onFocusComposer={focusComposer}
            onRemember={rememberMessage}
            onBack={() => navigate('/')}
            onOpenOps={openOps}
            onOpenSystems={openSystems}
            onNewThread={startNewThread}
          />
          {dock}
        </div>
        {overlays}
      </>
    );
  }

  return (
    <>
      <div
        className="command-deck"
        data-side={isRightInline ? 'true' : 'false'}
        data-systems={isSystemsInline ? 'true' : 'false'}
        data-core-state={displayState}
        data-core-preview={preview ? 'true' : 'false'}
      >
        {isSystemsInline ? (
          <aside className="systems-panel" aria-label="System information">
            <SystemsPanel />
          </aside>
        ) : null}

        <section
          className="core-stage"
          aria-label="CAERA intelligence field"
          data-core-state={displayState}
        >
          <Visualizer
            state={displayState}
            level={pushToTalk.status === 'recording' ? pushToTalk.level : undefined}
            className="core-display"
          />

          {preview || !isSystemsInline || !isRightInline ? (
            <div className="stage-head">
              <div className="stage-head-left">
                {preview ? (
                  <span className="stage-chip">
                    <span className="dot" aria-hidden="true" />
                    Preview: {config.label}
                  </span>
                ) : null}
              </div>

              <div className="stage-head-right">
                {preview ? (
                  <button
                    type="button"
                    className="stage-utility"
                    onClick={() => update({ visualizerPreview: null })}
                    title="Return to the live field state"
                  >
                    Exit preview
                  </button>
                ) : null}
                {!isSystemsInline ? (
                  <button
                    type="button"
                    className="stage-utility"
                    onClick={openSystems}
                    title="Open system information"
                  >
                    <Icon name="cpu" size={12} />
                    Systems
                  </button>
                ) : null}
                {!isRightInline ? (
                  <button
                    type="button"
                    className="stage-utility"
                    onClick={openOps}
                    title="Open operations"
                  >
                    <Icon name="activity" size={12} />
                    Ops
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="stage-copy">
            <h1 className="stage-state">{config.display}</h1>
            <p className="stage-description">{config.description}</p>

            {!conversationId && !pending ? (
              <div className="stage-quick" aria-label="Suggested commands">
                <button
                  type="button"
                  className="stage-primary"
                  onClick={() => {
                    if (modelConfigured) {
                      focusComposer();
                    } else {
                      navigate('/settings/provider');
                    }
                  }}
                >
                  {modelConfigured ? 'Start a thread' : 'Connect a model'}
                </button>
                <button
                  type="button"
                  className="stage-command"
                  onClick={() => usePrompt('Explain what runs locally in this build.')}
                >
                  Explain local runtime
                  <Icon name="chevronRight" size={10} className="chev" />
                </button>
              </div>
            ) : null}
          </div>
        </section>

        {isRightInline ? (
          <aside className="side-panel" aria-label="Operations and thread">
            <div className="side-tabs">
              <button
                type="button"
                className="side-tab"
                data-active={sideTab === 'ops'}
                onClick={() => setSideTab('ops')}
              >
                Operations
              </button>
              <button
                type="button"
                className="side-tab"
                data-active={sideTab === 'thread'}
                onClick={() => setSideTab('thread')}
              >
                Thread
                <span className="side-tab-count">{conversation?.messageCount ?? 0}</span>
              </button>
              <div className="side-spacer" />
              <button
                type="button"
                className="side-action"
                onClick={openHistory}
                title="Conversation history"
                aria-label="Conversation history"
              >
                <Icon name="history" size={13} />
              </button>
            </div>

            {sideTab === 'ops' ? (
              <OpsPanel
                conversation={conversation}
                pending={pending}
                sendError={sendError}
                onOpenThread={() => setSideTab('thread')}
              />
            ) : (
              <ThreadPanel
                coreState={instrument}
                audioLevel={pushToTalk.status === 'recording' ? pushToTalk.level : undefined}
                conversation={conversation}
                loading={loading}
                loadError={error}
                pending={pending}
                sendError={sendError}
                streaming={streaming}
                {...(voiceControls ? { voice: voiceControls } : {})}
                onNoticeAction={onNoticeAction}
                onDismissError={dismissError}
                onOpenProviderSettings={() => navigate('/settings/provider')}
                onRetryLoad={reload}
                onRename={(title) => void rename(title)}
                onDelete={() => setConfirmDelete(true)}
                onOpenHistory={openHistory}
                onFocusComposer={focusComposer}
                onRemember={rememberMessage}
                onNewThread={startNewThread}
              />
            )}
          </aside>
        ) : null}

        {dock}
      </div>
      {overlays}
    </>
  );
}
