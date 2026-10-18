import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { useTheme } from '@mui/material/styles';

import type { RecentProject } from '@/types';
import { formatDateTime, formatNumber } from '@/utils/format';

interface RecentProjectListProps {
  items: RecentProject[];
  busy: boolean;
  onOpen: (item: RecentProject) => void;
  onRemove: (item: RecentProject) => void;
}

export function RecentProjectList({ items, busy, onOpen, onRemove }: RecentProjectListProps) {
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
                borderradius: 1,
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
                {item.exists ? item.sourcePath : '文件已移动或删除（浏览器预览无法访问本地路径）'}
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
                  label={`${formatNumber(item.doneCount)} / ${formatNumber(item.itemCount)} 条`}
                />
                <Chip size="small" variant="outlined" label={`术语 ${formatNumber(item.glossaryCount)}`} />
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
              <Button size="small" onClick={() => onOpen(item)} disabled={busy || !item.exists}>
                打开
              </Button>
              <Tooltip title="从最近项目中移除">
                <span>
                  <IconButton
                    size="small"
                    aria-label={`移除 ${item.fileName}`}
                    onClick={() => onRemove(item)}
                    disabled={busy}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
