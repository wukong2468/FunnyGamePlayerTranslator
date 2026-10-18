import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export interface InfoItem {
  label: string;
  value: ReactNode;
}

export function InfoList({ items }: { items: InfoItem[] }) {
  return (
    <Box
      component="dl"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'max-content minmax(0, 1fr)',
        columnGap: 2,
        rowGap: 1.25,
        m: 0,
        alignItems: 'baseline',
      }}
    >
      {items.map((item) => (
        <Box key={item.label} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {item.label}
          </Typography>
          <Typography
            component="dd"
            variant="body2"
            sx={{ m: 0, minWidth: 0, wordBreak: 'break-all' }}
          >
            {item.value ?? '—'}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
