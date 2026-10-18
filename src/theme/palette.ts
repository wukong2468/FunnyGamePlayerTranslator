import type { PaletteMode, PaletteOptions } from '@mui/material';

type Rgb = [number, number, number];

export const DEFAULT_PRIMARY = '#3B82F6';

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function toRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function mix(source: Rgb, target: Rgb, weight: number): Rgb {
  const ratio = Math.min(1, Math.max(0, weight));
  return [
    source[0] + (target[0] - source[0]) * ratio,
    source[1] + (target[1] - source[1]) * ratio,
    source[2] + (target[2] - source[2]) * ratio,
  ];
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0'))
    .join('')}`;
}

function relativeLuminance(rgb: Rgb): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** 根据主色与主题模式推导完整的调色板。 */
export function buildPalette(primaryColor: string, mode: PaletteMode): PaletteOptions {
  const isDark = mode === 'dark';
  const base = toRgb(isHexColor(primaryColor) ? primaryColor : DEFAULT_PRIMARY);
  const main = isDark ? mix(base, [255, 255, 255], 0.24) : base;
  const light = isDark ? mix(main, [255, 255, 255], 0.32) : mix(main, [255, 255, 255], 0.24);
  const dark = isDark ? mix(main, [0, 0, 0], 0.12) : mix(main, [0, 0, 0], 0.22);
  const contrastText = relativeLuminance(main) > 0.55 ? '#0B1220' : '#FFFFFF';

  return {
    mode,
    primary: {
      main: toHex(main),
      light: toHex(light),
      dark: toHex(dark),
      contrastText,
    },
    secondary: {
      main: isDark ? '#5EEAD4' : '#0D9488',
      contrastText: isDark ? '#04211D' : '#FFFFFF',
    },
    background: {
      default: isDark ? '#0E1117' : '#F3F5F9',
      paper: isDark ? '#161B23' : '#FFFFFF',
    },
    text: {
      primary: isDark ? '#E7EBF2' : '#141A24',
      secondary: isDark ? '#9BA6B4' : '#5B6675',
      disabled: isDark ? '#5C6675' : '#9AA3B0',
    },
    divider: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 23, 42, 0.10)',
    success: { main: isDark ? '#4ADE80' : '#15803D' },
    warning: { main: isDark ? '#FBBF24' : '#B45309' },
    error: { main: isDark ? '#F87171' : '#DC2626' },
    info: { main: isDark ? '#60A5FA' : '#2563EB' },
    action: {
      hover: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.04)',
      selected: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 23, 42, 0.06)',
    },
  };
}
