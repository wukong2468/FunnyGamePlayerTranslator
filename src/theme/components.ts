import { alpha, type Components, type Theme } from '@mui/material/styles';

interface ComponentOptions {
  compact: boolean;
}

/** 统一的组件主题覆盖：尺寸、圆角、表格密度与交互状态。 */
export function buildComponents({ compact }: ComponentOptions): Components<Theme> {
  const controlHeight = compact ? 32 : 38;

  return {
    MuiCssBaseline: {
      styleOverrides: {
        html: { height: '100%' },
        body: {
          height: '100%',
          margin: 0,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        '#root': { height: '100%' },
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(120, 132, 148, 0.38)',
          borderRadius: 8,
          border: '2px solid transparent',
          backgroundClip: 'content-box',
        },
        '*::-webkit-scrollbar-thumb:hover': {
          backgroundColor: 'rgba(120, 132, 148, 0.6)',
        },
        code: {
          fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
          fontSize: '0.86em',
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid var(--mui-palette-divider)',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
          minHeight: controlHeight,
          paddingInline: compact ? 12 : 16,
        },
        sizeSmall: { minHeight: compact ? 28 : 32, paddingInline: 10 },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },
    MuiTextField: {
      defaultProps: { size: compact ? 'small' : 'medium' },
    },
    MuiSelect: {
      defaultProps: { size: compact ? 'small' : 'medium' },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'var(--mui-palette-divider)',
          },
        },
      },
    },
    MuiTableCell: {
      defaultProps: { size: compact ? 'small' : 'medium' },
      styleOverrides: {
        root: {
          borderColor: 'var(--mui-palette-divider)',
          verticalAlign: 'top',
          padding: compact ? '6px 10px' : '10px 14px',
        },
        head: {
          backgroundColor: 'var(--mui-palette-action-hover)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          color: 'var(--mui-palette-text-secondary)',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': { backgroundColor: 'var(--mui-palette-action-hover)' },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          height: compact ? 5 : 7,
          borderRadius: 999,
          backgroundColor: 'var(--mui-palette-action-hover)',
        },
        bar: { borderRadius: 999 },
      },
    },
    MuiChip: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        root: { fontWeight: 500, borderRadius: 6 },
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: true, enterDelay: 350 },
      styleOverrides: {
        tooltip: { fontSize: 12, borderRadius: 6 },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: compact ? 40 : 46 },
        indicator: { height: 3, borderRadius: 3 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          minHeight: compact ? 40 : 46,
          paddingInline: compact ? 12 : 18,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 14 },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: { fontSize: 17, fontWeight: 700, paddingBottom: 4 },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: { padding: '12px 20px 18px' },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 10,
          marginInline: 8,
          marginBottom: 2,
          minHeight: compact ? 36 : 42,
          '&.Mui-selected': {
            backgroundColor: alpha(theme.palette.primary.main, 0.14),
            color: theme.palette.primary.main,
            '& .MuiListItemIcon-root': { color: theme.palette.primary.main },
            '&:hover': {
              backgroundColor: alpha(theme.palette.primary.main, 0.2),
            },
          },
        }),
      },
    },
    MuiListItemIcon: {
      styleOverrides: {
        root: { minWidth: 34 },
      },
    },
    MuiListItemText: {
      styleOverrides: {
        primary: { fontSize: 14, fontWeight: 500 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 10, alignItems: 'center' },
      },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0, square: true },
      styleOverrides: {
        root: {
          border: '1px solid var(--mui-palette-divider)',
          borderRadius: 10,
          '&:before': { display: 'none' },
        },
      },
    },
    MuiSlider: {
      defaultProps: { size: compact ? 'small' : 'medium' },
    },
    MuiSkeleton: {
      styleOverrides: {
        root: { borderRadius: 6 },
      },
    },
    MuiTablePagination: {
      styleOverrides: {
        toolbar: { minHeight: compact ? 44 : 52 },
        selectLabel: { fontSize: 13 },
        displayedRows: { fontSize: 13 },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: { marginTop: 4, maxHeight: 380 },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        paper: { marginTop: 4 },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          textTransform: 'none',
          fontWeight: 500,
          paddingInline: 14,
          color: theme.palette.text.primary,
          borderColor: theme.palette.divider,
          '&.Mui-selected': {
            backgroundColor: alpha(theme.palette.primary.main, 0.16),
            borderColor: alpha(theme.palette.primary.main, 0.45),
            color: theme.palette.primary.main,
            '&:hover': {
              backgroundColor: alpha(theme.palette.primary.main, 0.24),
            },
          },
        }),
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: 'var(--mui-palette-divider)' },
      },
    },
  };
}
