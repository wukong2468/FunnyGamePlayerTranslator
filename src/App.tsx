import { Alert, Box, CircularProgress, CssBaseline, Typography, useMediaQuery } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { useEffect, useMemo } from 'react';

import { AppShell } from '@/components/layout/AppShell';
import { useAppStore } from '@/store/useAppStore';
import { createAppTheme } from '@/theme';
import { DEFAULT_APPEARANCE } from '@/types';

export default function App() {
  const ready = useAppStore((state) => state.ready);
  const fatalError = useAppStore((state) => state.fatalError);
  const settings = useAppStore((state) => state.settings);
  const bootstrap = useAppStore((state) => state.bootstrap);

  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const appearance = settings?.appearance ?? DEFAULT_APPEARANCE;
  const theme = useMemo(() => createAppTheme(appearance, prefersDark), [appearance, prefersDark]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {!ready && (
        <Box
          sx={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
          }}
        >
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            正在初始化工作区…
          </Typography>
        </Box>
      )}
      {ready && fatalError && (
        <Box sx={{ maxWidth: 640, mx: 'auto', mt: 8, px: 3 }}>
          <Alert severity="error">
            应用初始化失败，请检查数据目录权限后重启：{fatalError}
          </Alert>
        </Box>
      )}
      {ready && !fatalError && <AppShell />}
    </ThemeProvider>
  );
}
