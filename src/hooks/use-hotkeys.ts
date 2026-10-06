import { useEffect, useRef } from 'react';
import type { PanelState } from '@shared/state';
import { act } from '@/lib/api';
import { KEYS } from '@/lib/format';
import type { Marking } from './use-marking';

/** Keyboard control for the desktop view. Keys follow the order of the buttons on screen. */
export function useHotkeys(state: PanelState | null, marking: Marking, enabled: boolean) {
  // The listener is registered once; it reads the latest state through this ref.
  const latest = useRef({ state, marking });
  latest.current = { state, marking };

  useEffect(() => {
    if (!enabled) return;
    const at = (keys: readonly string[], key: string) => keys.indexOf(key);

    function onKey(e: KeyboardEvent) {
      const { state, marking } = latest.current;
      if (!state || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;

      const program = state.cams[at(KEYS.program, key)];
      const preview = state.cams[at(KEYS.preview, key)];
      const mark = state.replay.marks[at(KEYS.mark, key)];
      const type = state.replay.types[at(KEYS.type, key)];

      if (program) void act('program', { cam: program.id });
      else if (preview) { if (!preview.program) void act('preview', { cam: preview.id }); }
      else if (marking.pending && type) marking.pickType(type);
      else if (!marking.pending && mark && state.replayRecording) void marking.mark(mark.id);
      else if (key === KEYS.sponsor && state.sponsor) void act('sponsor/now');
      else if (key === KEYS.audioGame && state.audio) void act('audio/preset', { preset: 'game' });
      else if (key === KEYS.audioPause && state.audio) void act('audio/preset', { preset: 'pause' });
      else return;
      e.preventDefault(); // F1 / F3 would otherwise open browser help and search
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
