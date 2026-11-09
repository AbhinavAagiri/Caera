import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  isVisualizerState,
  type VisualizerState,
} from '@/components/visualizer/state';

export type ThemePreference = 'dark' | 'light' | 'system';
export type DensityPreference = 'comfortable' | 'compact';

export interface Preferences {
  theme: ThemePreference;
  density: DensityPreference;
  reduceMotion: boolean;
  displayName: string;
  startup: 'welcome' | 'resume';
  lastConversationId: string | null;
  pushToTalk: boolean;
  visualizerPreview: VisualizerState | null;
}

export const PREFERENCES_STORAGE_KEY = 'caera.preferences.v1';

const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  density: 'comfortable',
  reduceMotion: false,
  displayName: '',
  startup: 'welcome',
  lastConversationId: null,
  pushToTalk: true,
  visualizerPreview: null,
};

const THEMES: ThemePreference[] = ['dark', 'light', 'system'];
const DENSITIES: DensityPreference[] = ['comfortable', 'compact'];

function readPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;

  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;

    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      theme: THEMES.includes(parsed.theme as ThemePreference)
        ? (parsed.theme as ThemePreference)
        : DEFAULT_PREFERENCES.theme,
      density: DENSITIES.includes(parsed.density as DensityPreference)
        ? (parsed.density as DensityPreference)
        : DEFAULT_PREFERENCES.density,
      startup: parsed.startup === 'resume' ? 'resume' : 'welcome',
      visualizerPreview: isVisualizerState(parsed.visualizerPreview)
        ? parsed.visualizerPreview
        : null,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName.slice(0, 40) : '',
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

interface PreferencesValue {
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => void;
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // A blocked storage quota should never break the interface.
    }
  }, [preferences]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: light)');

    const apply = (): void => {
      const resolved =
        preferences.theme === 'system' ? (media.matches ? 'light' : 'dark') : preferences.theme;
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
    };

    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences.theme]);

  useEffect(() => {
    document.documentElement.dataset.density = preferences.density;
  }, [preferences.density]);

  useEffect(() => {
    document.documentElement.dataset.motion = preferences.reduceMotion ? 'reduced' : 'full';
  }, [preferences.reduceMotion]);

  const value = useMemo(
    () => ({ preferences, update, reset }),
    [preferences, update, reset],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider');
  return value;
}
