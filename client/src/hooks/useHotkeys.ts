import { useEffect } from 'react';

type Handler = (event: KeyboardEvent) => void;
export type HotkeyMap = Record<string, Handler>;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts.at(-1);
  const wantsMod = parts.includes('mod');
  const wantsShift = parts.includes('shift');
  const wantsAlt = parts.includes('alt');

  if (!key) return false;
  if (wantsMod !== (event.metaKey || event.ctrlKey)) return false;
  if (wantsShift !== event.shiftKey) return false;
  if (wantsAlt !== event.altKey) return false;

  return event.key.toLowerCase() === key;
}

export function useHotkeys(hotkeys: HotkeyMap, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent): void => {
      for (const [combo, callback] of Object.entries(hotkeys)) {
        if (!matches(event, combo)) continue;

        const isModCombo = combo.includes('mod+');
        if (!isModCombo && isTypingTarget(event.target)) return;

        event.preventDefault();
        callback(event);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hotkeys, enabled]);
}
