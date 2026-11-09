import { useCallback, useEffect, useState } from 'react';
import type { ConversationSummary } from '@shared';
import { onConversationsChanged } from '@/lib/appEvents';
import { api, isAbortError, toApiError, type ApiRequestError } from '@/services/api';

interface ConversationsState {
  conversations: ConversationSummary[];
  loading: boolean;
  error: ApiRequestError | null;
  reload: () => void;
}

export function useConversations(query?: string): ConversationsState {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [revision, setRevision] = useState(0);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    setLoading(true);
    api
      .listConversations(query, controller.signal)
      .then((data) => {
        if (!alive) return;
        setConversations(data.conversations);
        setError(null);
      })
      .catch((cause) => {
        if (!alive || isAbortError(cause)) return;
        setError(toApiError(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [query, revision]);

  useEffect(() => onConversationsChanged(reload), [reload]);

  return { conversations, loading, error, reload };
}
