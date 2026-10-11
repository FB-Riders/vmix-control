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
