import { Avatar, Box, Paper, Typography } from '@mui/material';
import type { ReactNode } from 'react';

type StatColor = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'default';

export interface StatItem {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  color?: StatColor;
}

function StatCard({ item }: { item: StatItem }) {
  const color = item.color ?? 'primary';
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.75,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        height: '100%',
        minWidth: 0,
      }}
    >
      {item.icon && (
        <Avatar
          variant="rounded"
          sx={{
            width: 36,
            height: 36,
            borderRadius: 2,
            bgcolor: color === 'default' ? 'action.hover' : `${color}.main`,
            color: color === 'default' ? 'text.secondary' : '#fff',
            opacity: color === 'default' ? 1 : 0.9,
            '& svg': { fontSize: '1.2rem' },
          }}
        >
          {item.icon}
        </Avatar>
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ whiteSpace: 'nowrap' }}
        >
          {item.label}
        </Typography>
        <Typography
          variant="h6"
          component="p"
          sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}
          noWrap
        >
          {item.value}
        </Typography>
        {item.hint && (
          <Typography variant="caption" color="text.secondary" component="p" noWrap>
            {item.hint}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

export function StatisticsGrid({ items, columns = 4 }: { items: StatItem[]; columns?: number }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          sm: 'repeat(3, minmax(0, 1fr))',
          lg: `repeat(${columns}, minmax(0, 1fr))`,
        },
      }}
    >
      {items.map((item) => (
        <StatCard key={item.label} item={item} />
      ))}
    </Box>
  );
}
