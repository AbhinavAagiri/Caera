import type { Message } from '@shared';

export interface StoredConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface ConversationStats {
  conversations: number;
  messages: number;
}
