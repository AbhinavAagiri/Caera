const CONVERSATIONS_CHANGED = 'caera:conversations-changed';

export function notifyConversationsChanged(): void {
  window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
}

export function onConversationsChanged(handler: () => void): () => void {
  window.addEventListener(CONVERSATIONS_CHANGED, handler);
  return () => window.removeEventListener(CONVERSATIONS_CHANGED, handler);
}
