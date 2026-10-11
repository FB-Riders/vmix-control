import { useEffect, useRef } from 'react';
import type { PanelState } from '@shared/state';
import { act } from '@/lib/api';
import { KEYS, penaltyKey } from '@/lib/format';
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
      e.preventDefault();
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/**
 * Keyboard control for the Einblender screen on the desktop, above all for the match clock by hand:
 * space starts and stops it, the arrows correct the time, H and G count goals, the penalty minutes start a penalty.
 * Shift turns a key around (10 s instead of 1, a goal off) or makes it act for the away team (penalties).
 */
export function useGfxHotkeys(state: PanelState | null, enabled: boolean) {
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!enabled) return;

    function onKey(e: KeyboardEvent) {
      const state = latest.current;
      if (!state?.gfx || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const { gfx, scoreboard: sb } = state;
      const manual = sb?.manual ? sb : null;
      // Digits by their place on the keyboard: with Shift they type something else.
      const key = e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const arrow = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
      const penalty = gfx.penalties.find((p) => penaltyKey(p) === key);
      if (e.repeat && !arrow) return;

      if (key === 'Escape') { if (gfx.live) void act('gfx/hide'); else return; }
      else if (key === 'N' && gfx.live?.six && gfx.live.six.shown < gfx.live.six.total) void act('gfx/next');
      else if (key === 'M' && sb && !state.shootout?.live) void act('scoreboard/show', { on: !sb.onAir });
      else if (!manual) return;
      else if (key === ' ') void act('scoreboard/run', { on: manual.runningSince === null });
      else if (arrow) void act('scoreboard/adjust', { seconds: arrow * (e.shiftKey ? 10 : 1) });
      else if (key === 'H' || key === 'G') {
        const team = key === 'H' ? 'home' : 'away';
        if (e.shiftKey && manual.score[team] === 0) return;
        void act('scoreboard/goal', { team, delta: e.shiftKey ? -1 : 1 });
      }
      else if (penalty) void act('scoreboard/addPenalty', { team: e.shiftKey ? 'away' : 'home', label: penalty });
      else return;
      e.preventDefault();
      // A button that still has the focus from a click would be pressed by the space bar as well.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
