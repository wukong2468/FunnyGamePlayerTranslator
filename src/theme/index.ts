import { createTheme, type Theme } from '@mui/material/styles';

import type { AppearanceSettings } from '@/types';

import { buildComponents } from './components';
import { buildPalette } from './palette';

export const FONT_STACKS: Record<string, string> = {
  system:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  yahei: '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif',
  noto: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  mono: '"Cascadia Code", "JetBrains Mono", Consolas, "Microsoft YaHei", monospace',
};

export const MONO_FONT_STACK = '"Cascadia Code", "JetBrains Mono", Consolas, monospace';

/** 根据外观设置创建全局主题。 */
export function createAppTheme(appearance: AppearanceSettings, systemPrefersDark: boolean): Theme {
  const mode =
    appearance.themeMode === 'system'
      ? systemPrefersDark
        ? 'dark'
        : 'light'
      : appearance.themeMode;
  const compact = appearance.density === 'compact';
  const fontFamily = FONT_STACKS[appearance.fontFamily] ?? FONT_STACKS.system;
  // 字号以 14 为基准缩放根节点 font-size，所有用 rem 定义的文字（含 MUI 内部样式）统一跟随
  const fontScale = appearance.fontSize / 14;

  return createTheme({
    cssVariables: true,
    palette: buildPalette(appearance.primaryColor, mode),
    shape: { borderRadius: 12 },
    spacing: compact ? 7 : 8,
    typography: {
      fontFamily,
      // 固定为 14，避免 MUI 的 pxToRem 系数与根字号缩放叠加导致重复放大
      fontSize: 14,
      h4: { fontSize: '1.65rem', fontWeight: 700 },
      h5: { fontSize: '1.35rem', fontWeight: 700 },
      h6: { fontSize: '1.08rem', fontWeight: 700 },
      subtitle1: { fontSize: '0.98rem', fontWeight: 600 },
      subtitle2: { fontSize: '0.86rem', fontWeight: 600 },
      body1: { fontSize: '0.9rem', lineHeight: 1.65 },
      body2: { fontSize: '0.84rem', lineHeight: 1.6 },
      caption: { fontSize: '0.76rem' },
      button: { fontSize: '0.86rem', fontWeight: 600, textTransform: 'none' },
    },
    components: buildComponents({ compact, fontScale }),
  });
}
