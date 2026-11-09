import { useEffect, useRef, useState } from 'react';
import type { Conversation, Message, NoticeActionId } from '@shared';
import { MessageItem } from '@/components/conversation/MessageItem';
import { MessageList } from '@/components/conversation/MessageList';
import { ThinkingIndicator } from '@/components/conversation/ThinkingIndicator';
import { Icon } from '@/components/icons/Icon';
import { Button, IconButton } from '@/components/ui/Button';
import { Visualizer } from '@/components/visualizer/Visualizer';
import type { VisualizerState } from '@/components/visualizer/state';
import type { ApiRequestError } from '@/services/api';
import type { VoicePlaybackState } from '@/services/voicePlayback';
import { formatRelative, pluralize } from '@/lib/format';

interface StreamingReply {
  message: Message;
  stopped: boolean;
}

interface ThreadPanelProps {
  conversation: Conversation | null;
  loading: boolean;
  loadError: ApiRequestError | null;
  pending: boolean;
  sendError: ApiRequestError | null;
  streaming: StreamingReply | null;
  /** Central CAERA state, including real capture and transcription phases. */
  coreState?: VisualizerState;
  audioLevel?: number;
  voice?: {
    enabled: boolean;
    ready: boolean;
    playback: VoicePlaybackState;
    onSpeak: (message: Message) => void;
    onStop: () => void;
  };
  narrow?: boolean;
  onNoticeAction: (action: NoticeActionId) => void;
  onRemember?: (message: Message) => void;
  onDismissError: () => void;
  onOpenProviderSettings: () => void;
  onRetryLoad: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onOpenHistory: () => void;
  onFocusComposer: () => void;
  onBack?: () => void;
  onOpenOps?: () => void;
  onOpenSystems?: () => void;
  onNewThread: () => void;
}

export function ThreadPanel({
  conversation,
  loading,
  loadError,
  pending,
  sendError,
  streaming,
  coreState,
  audioLevel,
  voice,
  narrow = false,
  onNoticeAction,
  onRemember,
  onDismissError,
  onOpenProviderSettings,
  onRetryLoad,
  onRename,
  onDelete,
  onOpenHistory,
  onFocusComposer,
  onBack,
  onOpenOps,
  onOpenSystems,
  onNewThread,
}: ThreadPanelProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation?.title ?? '');
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const previousId = useRef(conversation?.id);

  const activeStream =
    streaming && !conversation?.messages.some((message) => message.id === streaming.message.id)
      ? streaming
      : null;

  useEffect(() => {
    setDraft(conversation?.title ?? '');
    setEditing(false);
  }, [conversation?.id, conversation?.title]);

  useEffect(() => {
    if (editing) titleRef.current?.select();
  }, [editing]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const switched = previousId.current !== conversation?.id;
    previousId.current = conversation?.id;
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 180;
    if (switched || nearBottom || pending) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [
    conversation?.id,
    conversation?.messages.length,
    pending,
    sendError,
    activeStream?.message.content.length,
    activeStream?.stopped,
  ]);

  const commitRename = (): void => {
    const next = draft.trim();
    setEditing(false);
    if (!conversation || !next || next === conversation.title) {
      setDraft(conversation?.title ?? '');
      return;
    }
    onRename(next);
  };

  const headerClass = narrow ? 'thread-workspace-head' : 'thread-head';
  const bodyClass = narrow ? 'thread-workspace-body' : 'thread-body';

  return (
    <div className="thread-panel">
      <div className={headerClass}>
        {narrow ? (
          <IconButton icon="chevronLeft" label="Back to the core" size="sm" onClick={onBack} />
        ) : (
          <Visualizer
            compact
            size={18}
            state={
              coreState ??
              (pending
                ? 'thinking'
                : sendError
                  ? 'error'
                  : voice?.playback.status === 'playing'
                    ? 'speaking'
                    : 'idle')
            }
            level={audioLevel}
            className="shrink-0"
          />
        )}

        <div className="thread-title-block">
          {editing && conversation ? (
            <input
              ref={titleRef}
              value={draft}
              maxLength={80}
              aria-label="Thread title"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRename();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraft(conversation.title);
                  setEditing(false);
                }
              }}
              className="thread-rename"
            />
          ) : (
            <button
              type="button"
              className="thread-title"
              onClick={() => conversation && setEditing(true)}
              disabled={!conversation}
              title={conversation ? 'Rename thread' : undefined}
            >
              <span>{conversation?.title ?? 'Threads'}</span>
              {conversation ? <Icon name="edit" size={9} className="edit" /> : null}
            </button>
          )}
          <p className="thread-meta">
            {conversation
              ? `${pluralize(conversation.messageCount, 'message')} / stored locally / ${formatRelative(conversation.updatedAt)}`
              : 'local conversation store'}
          </p>
        </div>

        <div className="thread-actions">
          {narrow && onOpenOps ? (
            <IconButton icon="panelRight" label="Open operations" size="sm" onClick={onOpenOps} />
          ) : null}
          {narrow && onOpenSystems ? (
            <IconButton icon="cpu" label="Open systems" size="sm" onClick={onOpenSystems} />
          ) : null}
          <IconButton icon="history" label="Conversation history" size="sm" onClick={onOpenHistory} />
          <IconButton
            icon="trash"
            label="Delete thread"
            size="sm"
            disabled={!conversation}
            onClick={onDelete}
          />
        </div>
      </div>

      <div ref={bodyRef} className={bodyClass}>
        <div className={narrow ? 'thread-workspace-inner' : undefined}>
          {loading && !conversation ? (
            <div className="thread-skeleton" aria-hidden="true">
              <span />
              <span className="w-[82%]" />
              <span />
            </div>
          ) : loadError && !conversation ? (
            <div className="thread-empty">
              <span className="grid size-9 place-items-center rounded-full border border-[color-mix(in_oklab,var(--c-danger)_32%,var(--c-line))] text-danger">
                <Icon name="warning" size={15} />
              </span>
              <h2>Thread unavailable</h2>
              <p>{loadError.message || 'This conversation is not in the local store.'}</p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="secondary" icon="refresh" onClick={onRetryLoad}>
                  Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={onNewThread}>
                  New thread
                </Button>
              </div>
            </div>
          ) : conversation ? (
            <>
              <MessageList
                messages={conversation.messages}
                onNoticeAction={onNoticeAction}
                {...(onRemember ? { onRemember } : {})}
                {...(voice ? { voice } : {})}
              />
              {activeStream && activeStream.message.content ? (
                <div className="mt-5">
                  <MessageItem
                    message={activeStream.message}
                    onNoticeAction={onNoticeAction}
                    streaming={!activeStream.stopped}
                    stopped={activeStream.stopped}
                  />
                </div>
              ) : null}
              {pending && (!activeStream || !activeStream.message.content) ? (
                <div className="mt-5">
                  <ThinkingIndicator label="CAERA is thinking" />
                </div>
              ) : null}
              {sendError ? (
                <div className="thread-error">
                  <div className="min-w-0">
                    <p>{sendError.message}</p>
                    {sendError.hint ? (
                      <p className="mt-0.5 text-[9.5px] text-ink-3">{sendError.hint}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {sendError.code.startsWith('PROVIDER_') ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={onOpenProviderSettings}
                      >
                        Provider
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={onDismissError}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              ) : null}
              <div ref={endRef} className="h-px" />
            </>
          ) : (
            <div className="thread-empty">
              <span className="text-accent">
                <Visualizer compact size={30} state="idle" />
              </span>
              <h2>No thread open</h2>
              <p>
                Replies stream from the local node into this thread. Pick a stored conversation or
                begin typing in the deck below.
              </p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="primary" onClick={onFocusComposer}>
                  Command deck
                </Button>
                <Button size="sm" variant="secondary" icon="history" onClick={onOpenHistory}>
                  History
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {!narrow ? (
        <div className="thread-foot">
          <span className="flex items-center gap-1.5">
            <span className="size-[4px] rounded-full bg-[var(--c-accent)]" aria-hidden="true" />
            Local thread
          </span>
          <span>deck below</span>
        </div>
      ) : null}
    </div>
  );
}
