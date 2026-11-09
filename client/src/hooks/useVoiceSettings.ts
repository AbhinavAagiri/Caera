import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceConfigInput, VoiceSettingsResult } from '@shared';
import { api, isAbortError, toApiError, type ApiRequestError } from '@/services/api';

export const VOICE_SETTINGS_EVENT = 'caera:voice-settings-changed';

export function notifyVoiceSettingsChanged(): void {
  window.dispatchEvent(new Event(VOICE_SETTINGS_EVENT));
}

interface VoiceSettingsValue {
  settings: VoiceSettingsResult | null;
  loading: boolean;
  error: ApiRequestError | null;
  saving: boolean;
  checking: boolean;
  refresh: () => void;
  save: (input: VoiceConfigInput) => Promise<VoiceSettingsResult>;
  check: () => Promise<VoiceSettingsResult>;
}

export function useVoiceSettings(): VoiceSettingsValue {
  const [settings, setSettings] = useState<VoiceSettingsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const result = await api.voiceSettings(signal);
      if (!mounted.current) return;
      setSettings(result);
      setError(null);
    } catch (cause) {
      if (!mounted.current || isAbortError(cause)) return;
      setError(toApiError(cause));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);

    const onChange = (): void => {
      void load();
    };
    window.addEventListener(VOICE_SETTINGS_EVENT, onChange);

    return () => {
      mounted.current = false;
      controller.abort();
      window.removeEventListener(VOICE_SETTINGS_EVENT, onChange);
    };
  }, [load]);

  const save = useCallback(async (input: VoiceConfigInput): Promise<VoiceSettingsResult> => {
    setSaving(true);
    try {
      const result = await api.updateVoiceSettings(input);
      if (mounted.current) {
        setSettings(result);
        setError(null);
      }
      notifyVoiceSettingsChanged();
      return result;
    } catch (cause) {
      throw toApiError(cause);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, []);

  const check = useCallback(async (): Promise<VoiceSettingsResult> => {
    setChecking(true);
    try {
      const result = await api.checkVoice();
      if (mounted.current) {
        setSettings(result);
        setError(null);
      }
      notifyVoiceSettingsChanged();
      return result;
    } catch (cause) {
      throw toApiError(cause);
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return {
    settings,
    loading,
    error,
    saving,
    checking,
    refresh,
    save,
    check,
  };
}
