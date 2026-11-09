import type { VoiceSpeechInput, VoiceTestInput } from '@shared';
import { api, isAbortError } from './api';

export type VoicePlaybackStatus = 'idle' | 'generating' | 'playing';

export interface VoicePlaybackState {
  status: VoicePlaybackStatus;
  messageId: string | null;
}

type Listener = (state: VoicePlaybackState) => void;

const listeners = new Set<Listener>();

let state: VoicePlaybackState = { status: 'idle', messageId: null };
let controller: AbortController | null = null;
let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let token = 0;

function setState(next: VoicePlaybackState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

function cleanupAudio(): void {
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

export function subscribeVoicePlayback(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function getVoicePlaybackState(): VoicePlaybackState {
  return state;
}

export function stopVoicePlayback(): void {
  token += 1;
  controller?.abort();
  controller = null;
  cleanupAudio();
  setState({ status: 'idle', messageId: null });
}

async function playBlob(blob: Blob, messageId: string | null, activeToken: number): Promise<void> {
  cleanupAudio();

  objectUrl = URL.createObjectURL(blob);
  const element = new Audio(objectUrl);
  audio = element;

  element.onended = () => {
    if (activeToken !== token) return;
    cleanupAudio();
    setState({ status: 'idle', messageId: null });
  };
  element.onerror = () => {
    if (activeToken !== token) return;
    cleanupAudio();
    setState({ status: 'idle', messageId: null });
  };

  await element.play();
  if (activeToken !== token) return;
  setState({ status: 'playing', messageId });
}

export async function speakMessage(input: VoiceSpeechInput): Promise<void> {
  stopVoicePlayback();
  const activeToken = ++token;
  const current = new AbortController();
  controller = current;
  setState({ status: 'generating', messageId: input.messageId });

  try {
    const result = await api.speakMessage(input, current.signal);
    if (activeToken !== token) return;
    await playBlob(result.blob, input.messageId, activeToken);
  } catch (cause) {
    if (activeToken !== token || isAbortError(cause)) return;
    cleanupAudio();
    setState({ status: 'idle', messageId: null });
    throw cause;
  } finally {
    if (controller === current) controller = null;
  }
}

export async function testVoice(input: VoiceTestInput = {}): Promise<void> {
  stopVoicePlayback();
  const activeToken = ++token;
  const current = new AbortController();
  controller = current;
  setState({ status: 'generating', messageId: null });

  try {
    const result = await api.testVoice(input, current.signal);
    if (activeToken !== token) return;
    await playBlob(result.blob, null, activeToken);
  } catch (cause) {
    if (activeToken !== token || isAbortError(cause)) return;
    cleanupAudio();
    setState({ status: 'idle', messageId: null });
    throw cause;
  } finally {
    if (controller === current) controller = null;
  }
}
