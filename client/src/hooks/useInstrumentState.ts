import type { VisualizerState } from '@/components/visualizer/state';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { usePreferences } from '@/contexts/PreferencesContext';

interface InstrumentSignals {
  busy?: boolean;
  error?: boolean;
  speaking?: boolean;
  /** Live voice phase that outranks thinking and speaking. */
  phase?: VisualizerState | null;
  /** Settings uses this to render the exact live state without a preview override. */
  allowPreview?: boolean;
}

/**
 * Live state for the instrument. `speaking` is true only while VoiceStudio
 * audio is actually playing through the browser.
 */
export function useInstrumentState({
  busy = false,
  error = false,
  speaking = false,
  phase = null,
  allowPreview = true,
}: InstrumentSignals = {}): VisualizerState {
  const { preferences } = usePreferences();
  const node = useLocalNode();

  if (allowPreview && preferences.visualizerPreview) return preferences.visualizerPreview;
  if (node.status === 'offline') return 'offline';
  if (error) return 'error';
  if (phase) return phase;
  if (busy) return 'thinking';
  if (speaking) return 'speaking';
  return 'idle';
}
