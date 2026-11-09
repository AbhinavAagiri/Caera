import type { Message, NoticeActionId } from '@shared';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { formatClock } from '@/lib/format';
import type { VoicePlaybackState } from '@/services/voicePlayback';
import { MarkdownMessage } from './MarkdownMessage';

export interface MessageVoiceControls {
  enabled: boolean;
  ready: boolean;
  playback: VoicePlaybackState;
  onSpeak: () => void;
  onStop: () => void;
}

export function MessageItem({
  message,
  onNoticeAction,
  streaming = false,
  stopped = false,
  voice,
  onRemember,
}: {
  message: Message;
  onNoticeAction: (action: NoticeActionId) => void;
  streaming?: boolean;
  stopped?: boolean;
  voice?: MessageVoiceControls;
  onRemember?: (message: Message) => void;
}): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <article>
        <div className="msg-head">
          <span className="who" data-role="user">
            Operator / command
          </span>
          <time dateTime={message.createdAt} className="msg-time">
            {formatClock(message.createdAt)}
          </time>
        </div>
        <div className="msg-user">{message.content}</div>
        {onRemember ? (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1.5 rounded-[4px] border border-line px-2 text-[10px] text-ink-3 t-ui hover:bg-raised hover:text-ink"
              onClick={() => onRemember(message)}
              title="Approve a memory from this message"
            >
              <Icon name="memory" size={11} />
              Remember
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  if (message.kind === 'notice') {
    const tone = message.notice?.tone ?? 'info';
    const icon = tone === 'error' ? 'warning' : tone === 'warning' ? 'warning' : 'info';

    return (
      <article>
        <div className="msg-notice" data-tone={tone}>
          <div className="msg-notice-head">
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon
                name={icon}
                size={10}
                className={tone === 'error' ? 'text-danger' : 'text-ink-4'}
              />
              <strong className="truncate">{message.notice?.title ?? 'System notice'}</strong>
            </span>
            <time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time>
          </div>
          <div className="msg-notice-body">
            <MarkdownMessage content={message.content} />
            {message.notice?.actions?.length ? (
              <div className="msg-notice-actions">
                {message.notice.actions.map((action) => (
                  <Button
                    key={action.id}
                    variant="secondary"
                    size="sm"
                    onClick={() => onNoticeAction(action.id)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article>
      <div className="msg-head">
        <span className="who" data-role="assistant">
          CAERA / response
        </span>
        {streaming ? (
          <span className="msg-time" role="status">
            streaming
          </span>
        ) : stopped ? (
          <span className="msg-time">stopped</span>
        ) : (
          <time dateTime={message.createdAt} className="msg-time">
            {formatClock(message.createdAt)}
          </time>
        )}
      </div>
      <div className="msg-assistant">
        <MarkdownMessage content={message.content} />
      </div>
      {voice?.enabled ? (
        <div className="mt-2.5 flex items-center gap-2">
          {!voice.ready ? (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] text-ink-4"
              title="VoiceStudio is not ready. Open Settings → Voice for troubleshooting."
            >
              <Icon name="volumeOff" size={11} />
              Voice unavailable
            </span>
          ) : voice.playback.status !== 'idle' && voice.playback.messageId === message.id ? (
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1.5 rounded-[4px] border border-line px-2 text-[10px] text-ink-3 t-ui hover:bg-raised hover:text-ink"
              onClick={voice.onStop}
            >
              <Icon name={voice.playback.status === 'generating' ? 'stop' : 'volumeOff'} size={11} />
              {voice.playback.status === 'generating' ? 'Generating audio… Stop' : 'Stop speaking'}
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1.5 rounded-[4px] border border-line px-2 text-[10px] text-ink-3 t-ui hover:bg-raised hover:text-ink"
              onClick={voice.onSpeak}
              title="Generate speech for this reply with VoiceStudio"
            >
              <Icon name="volume" size={11} />
              Speak reply
            </button>
          )}
        </div>
      ) : null}
      {onRemember ? (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1.5 rounded-[4px] border border-line px-2 text-[10px] text-ink-3 t-ui hover:bg-raised hover:text-ink"
            onClick={() => onRemember(message)}
            title="Approve a memory from this reply"
          >
            <Icon name="memory" size={11} />
            Remember
          </button>
        </div>
      ) : null}
    </article>
  );
}
