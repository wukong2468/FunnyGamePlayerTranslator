import { Box, Button, Chip, List, ListItem, Paper, Typography } from '@mui/material';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { useTheme } from '@mui/material/styles';

import type { ProjectEntry } from '@/types';
import { formatDateTime } from '@/utils/format';

interface ProjectListProps {
  items: ProjectEntry[];
  busy: boolean;
  onOpen: (item: ProjectEntry) => void;
}

export function ProjectList({ items, busy, onOpen }: ProjectListProps) {
  const theme = useTheme();

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <List disablePadding>
        {items.map((item, index) => (
          <ListItem
            key={item.sourcePath}
            divider={index < items.length - 1}
            sx={{ gap: 1.5, py: 1.5, px: 2, alignItems: 'flex-start' }}
          >
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: 1,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'action.hover',
                color: 'text.secondary',
                flex: 'none',
                mt: 0.25,
              }}
            >
              <InsertDriveFileOutlinedIcon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="subtitle2" noWrap title={item.fileName}>
                {item.fileName}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                component="p"
                sx={{ wordBreak: 'break-all' }}
              >
                {item.sourcePath}
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  gap: 0.5,
                  flexWrap: 'wrap',
                  mt: 0.75,
                  alignItems: 'center',
                }}
              >
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${item.sourceLang} → ${item.targetLang}`}
                />
                <Typography
                  variant="caption"
                  color={theme.palette.text.disabled}
                  sx={{ ml: 0.5 }}
                >
                  {formatDateTime(item.updatedAt)}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flex: 'none' }}>
              <Button size="small" onClick={() => onOpen(item)} disabled={busy}>
                打开
              </Button>
            </Box>
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
