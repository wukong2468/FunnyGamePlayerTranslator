import {
  Box,
  Chip,
  FormControlLabel,
  IconButton,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useEffect, useRef, useState } from 'react';

import type { LogEntry } from '@/types';
import { formatClock } from '@/utils/format';
import { MONO_FONT_STACK } from '@/theme';

const LEVEL_META: Record<string, { label: string; color: string }> = {
  error: { label: '错误', color: 'error.main' },
  warn: { label: '警告', color: 'warning.main' },
  info: { label: '信息', color: 'text.secondary' },
};

interface LogPanelProps {
  logs: LogEntry[];
  onClear?: () => void;
  maxHeight?: number;
}

export function LogPanel({ logs, onClear, maxHeight = 220 }: LogPanelProps) {
  const [follow, setFollow] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!follow) {
      return;
    }
    const element = containerRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [logs, follow]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2">运行日志</Typography>
        <Chip size="small" variant="outlined" label={`${logs.length} 条`} />
        <Box sx={{ flex: 1 }} />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
            />
          }
          label={<Typography variant="caption">自动跟随</Typography>}
          sx={{ mr: 0.5 }}
        />
        <Tooltip title="清空日志">
          <span>
            <IconButton
              size="small"
              aria-label="清空运行日志"
              onClick={onClear}
              disabled={!onClear || logs.length === 0}
            >
              <DeleteSweepIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      <Box
        ref={containerRef}
        role="log"
        aria-live="polite"
        sx={{
          bgcolor: 'action.hover',
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
          p: 1.25,
          height: maxHeight,
          overflowY: 'auto',
          fontFamily: MONO_FONT_STACK,
          fontSize: '0.75rem',
          lineHeight: 1.65,
        }}
      >
        {logs.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            暂无日志。启动任务后可在此查看实时执行记录。
          </Typography>
        ) : (
          logs.map((entry, index) => {
            const meta = LEVEL_META[entry.level] ?? LEVEL_META.info;
            return (
              <Box
                key={`${entry.time}-${index}`}
                sx={{ display: 'flex', gap: 1, mb: 0.25, alignItems: 'flex-start' }}
              >
                <Box component="span" sx={{ color: 'text.disabled', flex: 'none' }}>
                  {formatClock(entry.time)}
                </Box>
                <Box component="span" sx={{ color: meta.color, flex: 'none', fontWeight: 600 }}>
                  [{meta.label}]
                </Box>
                <Box
                  component="span"
                  sx={{ color: 'text.primary', wordBreak: 'break-word', minWidth: 0 }}
                >
                  {entry.message}
                </Box>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
