import { Fragment } from 'react';
import type { Message, NoticeActionId } from '@shared';
import type { VoicePlaybackState } from '@/services/voicePlayback';
import { MessageItem } from './MessageItem';

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function MessageList({
  messages,
  onNoticeAction,
  voice,
  onRemember,
}: {
  messages: Message[];
  onNoticeAction: (action: NoticeActionId) => void;
  onRemember?: (message: Message) => void;
  voice?: {
    enabled: boolean;
    ready: boolean;
    playback: VoicePlaybackState;
    onSpeak: (message: Message) => void;
    onStop: () => void;
  };
}): React.JSX.Element {
  let lastDay = '';

  return (
    <div className="msg-list">
      {messages.map((message) => {
        const day = new Date(message.createdAt).toDateString();
        const showDay = day !== lastDay;
        lastDay = day;

        return (
          <Fragment key={message.id}>
            {showDay ? (
              <div className="msg-day" aria-label={dayLabel(message.createdAt)}>
                {dayLabel(message.createdAt)}
              </div>
            ) : null}
            <MessageItem
              message={message}
              onNoticeAction={onNoticeAction}
              {...(onRemember ? { onRemember } : {})}
              {...(voice
                ? {
                    voice: {
                      enabled: voice.enabled,
                      ready: voice.ready,
                      playback: voice.playback,
                      onSpeak: () => voice.onSpeak(message),
                      onStop: voice.onStop,
                    },
                  }
                : {})}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
