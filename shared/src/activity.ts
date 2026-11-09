import type { IsoTimestamp } from './conversations.js';

export type ActivityKind =
  | 'agent'
  | 'confirmation'
  | 'connection'
  | 'conversation'
  | 'message'
  | 'provider'
  | 'memory'
  | 'tool'
  | 'voice'
  | 'research'
  | 'error'
  | 'system';

export type ActivityStatus = 'info' | 'started' | 'progress' | 'completed' | 'failed';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  status: ActivityStatus;
  summary: string;
  detail: string | null;
  at: IsoTimestamp;
  source: 'server' | 'client';
  meta?: Record<string, string | number | boolean>;
}

export interface ActivityStreamHello {
  type: 'hello';
  events: ActivityEvent[];
  serverTime: IsoTimestamp;
}

export interface ActivityStreamEvent {
  type: 'event';
  event: ActivityEvent;
}

export type ActivityStreamMessage = ActivityStreamHello | ActivityStreamEvent;
