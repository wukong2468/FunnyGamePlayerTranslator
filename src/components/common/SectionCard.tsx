import { Box, Paper, Typography, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';

interface SectionCardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  contentSx?: SxProps<Theme>;
  noPadding?: boolean;
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  contentSx,
  noPadding = false,
}: SectionCardProps) {
  return (
    <Paper
      variant="outlined"
      sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}
    >
      {(title || action) && (
        <Box
          sx={{
            px: 2.5,
            py: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {title && (
              <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700 }}>
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography
                component="p"
                variant="caption"
                color="text.secondary"
                sx={{ mt: 0.25 }}
              >
                {subtitle}
              </Typography>
            )}
          </Box>
          {action}
        </Box>
      )}
      <Box
        sx={[
          { flex: 1, minWidth: 0, p: noPadding ? 0 : 2.5 },
          ...(Array.isArray(contentSx) ? contentSx : [contentSx]),
        ]}
      >
        {children}
      </Box>
    </Paper>
  );
}
