/** ["L", "M"] -> "L + M", ["M"] -> "nur M" */
export const camsLabel = (cams: string[]) => (cams.length === 1 ? `nur ${cams[0]}` : cams.join(' + '));

// Keyboard layout of the desktop view, by position in the respective row.
export const KEYS = {
  program: ['F1', 'F2', 'F3', 'F4'],
  preview: ['1', '2', '3', '4'],
  mark: ['Q', 'W', 'E', 'R'],
  type: ['A', 'S', 'D', 'F'],
  sponsor: 'G',
  audioGame: 'H',
  audioPause: 'J',
} as const;
