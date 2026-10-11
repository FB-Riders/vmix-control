/** ["L", "M"] -> "L + M", ["M"] -> "nur M" */
export const camsLabel = (cams: string[]) => (cams.length === 1 ? `nur ${cams[0]}` : cams.join(' + '));

// Keyboard layout of the desktop view, by position in the respective row.
export const KEYS = {
  program: ['Q', 'W', 'E', 'R'],
  preview: ['A', 'S', 'D', 'F'],
  // Replays under the right hand: mark in the top row, then the type in the row below.
  mark: ['U', 'I', 'O', 'P'],
  type: ['H', 'J', 'K', 'L'],
  sponsor: 'G',
  audioGame: 'N',
  audioPause: 'M',
} as const;

// Keyboard layout of the Einblender screen. With Shift a key does the opposite or acts for the away team.
export const GFX_KEYS = {
  run: 'Leertaste', // clock start / stop
  second: '← →', // game time -1 s / +1 s, with Shift 10 s
  home: 'H', // goal for the home team, with Shift one off
  away: 'G',
  clock: 'M', // match clock on / off
  next: 'N', // starting six: next player
  hide: 'Esc', // Einblender off
} as const;

/** Key that starts a penalty of this kind on the clock: its minutes ("2'" -> 2, "2'+2'" -> 4). Shift = away team. */
export function penaltyKey(label: string): string | null {
  const minutes = (label.match(/\d+/g) ?? []).reduce((sum, n) => sum + Number(n), 0);
  return minutes >= 1 && minutes <= 9 ? String(minutes) : null;
}
