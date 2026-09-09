export const THEME_COLORS = {
  void: '#05070c',
  void2: '#090d16',
  panel: 'rgba(16, 22, 34, 0.55)',
  panelStrong: 'rgba(20, 27, 42, 0.72)',
  border: 'rgba(148, 197, 255, 0.14)',
  borderStrong: 'rgba(148, 197, 255, 0.28)',
  borderFocus: 'rgba(79, 216, 255, 0.7)',

  cyan: '#4fd8ff',
  violet: '#8b7bff',
  amber: '#ffb454',
  amberDim: 'rgba(255, 180, 84, 0.15)',
  amberBorder: 'rgba(255, 180, 84, 0.35)',

  statusActive: '#4ee38a',
  mist: '#d3ddec',
  dim: '#728098',
  dimmer: '#4b5871',
} as const;

export type ThemeColors = typeof THEME_COLORS;
