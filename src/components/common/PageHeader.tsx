import { Avatar, Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, icon, actions }: PageHeaderProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
        mb: 2.5,
        flexWrap: 'wrap',
      }}
    >
      {icon && (
        <Avatar
          variant="rounded"
          sx={{
            bgcolor: 'action.hover',
            color: 'primary.main',
            width: 42,
            height: 42,
            borderRadius: 2,
          }}
        >
          {icon}
        </Avatar>
      )}
      <Box sx={{ flex: 1, minWidth: 200 }}>
        <Typography component="h1" variant="h5" sx={{ letterSpacing: '-0.01em' }}>
          {title}
        </Typography>
        {description && (
          <Typography component="p" variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {description}
          </Typography>
        )}
      </Box>
      {actions && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 1,
            flexWrap: 'wrap',
            flexShrink: 0,
            maxWidth: '100%',
            '& .MuiButton-root': { flexShrink: 0, whiteSpace: 'nowrap' },
          }}
        >
          {actions}
        </Box>
      )}
    </Box>
  );
}
