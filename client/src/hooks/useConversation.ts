import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation } from '@shared';
import { api, isAbortError, toApiError, type ApiRequestError } from '@/services/api';

interface ConversationState {
  conversation: Conversation | null;
  loading: boolean;
  error: ApiRequestError | null;
  setConversation: (conversation: Conversation) => void;
  reload: () => void;
}

export function useConversation(id: string | undefined): ConversationState {
  const [conversation, setConversationState] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [revision, setRevision] = useState(0);
  const localVersion = useRef(0);

  const setConversation = useCallback((next: Conversation) => {
    localVersion.current += 1;
    setConversationState(next);
  }, []);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!id) {
      localVersion.current += 1;
      setConversationState(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let alive = true;
    const fetchVersion = localVersion.current;

    setConversationState((current) => (current && current.id === id ? current : null));
    setLoading(true);
    api
      .getConversation(id, controller.signal)
      .then((data) => {
        if (!alive || localVersion.current !== fetchVersion) return;
        setConversationState(data.conversation);
        setError(null);
      })
      .catch((cause) => {
        if (!alive || isAbortError(cause) || localVersion.current !== fetchVersion) return;
        setError(toApiError(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [id, revision]);

  return { conversation, loading, error, setConversation, reload };
}
