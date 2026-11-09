export const VISUALIZER_STATES = [
  'idle',
  'listening',
  'transcribing',
  'thinking',
  'speaking',
  'interrupted',
  'error',
  'offline',
] as const;

export type VisualizerState = (typeof VISUALIZER_STATES)[number];

export type VisualizerTone = 'accent' | 'danger' | 'muted';

export interface VisualizerConfig {
  /** Short technical label, used in compact contexts. */
  label: string;
  /** The human sentence shown beneath the core. */
  display: string;
  /** What the state means, in CAERA's voice. */
  description: string;
  tone: VisualizerTone;
  /** Machine readout in the caption. */
  readout: string;
}

export const VISUALIZER_CONFIG: Record<VisualizerState, VisualizerConfig> = {
  idle: {
    label: 'Idle',
    display: 'Awaiting command',
    description: 'The local node is online. The signal field is quiet and ready for instruction.',
    tone: 'accent',
    readout: 'idle / ready',
  },
  listening: {
    label: 'Listening',
    display: 'Input channel open',
    description: 'Push-to-talk is recording this machine’s microphone. Release to transcribe the recording.',
    tone: 'accent',
    readout: 'input / recording',
  },
  transcribing: {
    label: 'Transcribing',
    display: 'Reading the recording',
    description: 'The recording is being transcribed by VoiceStudio on this machine, not by a hosted speech service.',
    tone: 'accent',
    readout: 'input / local ASR',
  },
  thinking: {
    label: 'Processing',
    display: 'Working through it',
    description: 'A request is in flight. The local node is routing context through the available tools.',
    tone: 'accent',
    readout: 'processing',
  },
  speaking: {
    label: 'Speaking',
    display: 'Relaying response',
    description: 'VoiceStudio is reading the reply aloud on this machine. Stop it from the reply or the voice channel.',
    tone: 'accent',
    readout: 'output / local',
  },
  interrupted: {
    label: 'Interrupted',
    display: 'Response interrupted',
    description: 'The turn was stopped before it finished. Continue typing, or hold the microphone to speak again.',
    tone: 'accent',
    readout: 'stopped / ready',
  },
  error: {
    label: 'Fault',
    display: 'Fault detected',
    description: 'The last operation failed. Open Activity for the local trace before retrying.',
    tone: 'danger',
    readout: 'fault / inspect log',
  },
  offline: {
    label: 'Offline',
    display: 'Signal lost',
    description: 'The local node is unreachable. Restore the service to bring the field back online.',
    tone: 'muted',
    readout: 'no signal',
  },
};

export function isVisualizerState(value: unknown): value is VisualizerState {
  return typeof value === 'string' && (VISUALIZER_STATES as readonly string[]).includes(value);
}

export const STATE_TONE_VAR: Record<VisualizerTone, string> = {
  accent: 'var(--c-accent)',
  danger: 'var(--c-danger)',
  muted: 'var(--c-ink-3)',
};
