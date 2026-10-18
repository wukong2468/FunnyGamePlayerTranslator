import { Box, Chip, LinearProgress, Typography } from '@mui/material';

import type { JobSnapshot } from '@/types';
import { formatDuration, formatNumber } from '@/utils/format';

export function TaskProgress({ snapshot }: { snapshot: JobSnapshot | null }) {
  const total = snapshot?.total ?? 0;
  const done = snapshot?.done ?? 0;
  const failed = snapshot?.failed ?? 0;
  const pending = snapshot?.pending ?? 0;
  const processed = done + failed;
  const percent = total > 0 ? Math.min(100, (processed / total) * 100) : 0;

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} color="text.secondary">
          {snapshot?.message || '尚未开始，运行任务后可在此查看实时进度'}
        </Typography>
        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
          {formatNumber(processed)} / {formatNumber(total)} · {Math.round(percent)}%
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={percent}
        color={failed > 0 ? 'warning' : 'primary'}
        aria-label="任务进度"
      />
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.5 }}>
        <Chip size="small" color="success" variant="outlined" label={`已完成 ${formatNumber(done)}`} />
        <Chip
          size="small"
          color={failed > 0 ? 'error' : 'default'}
          variant="outlined"
          label={`失败 ${formatNumber(failed)}`}
        />
        <Chip size="small" variant="outlined" label={`待处理 ${formatNumber(pending)}`} />
        <Chip size="small" variant="outlined" label={`并发 ${snapshot?.running ?? 0}`} />
        <Chip
          size="small"
          variant="outlined"
          label={`批次 ${snapshot?.batchDone ?? 0} / ${snapshot?.batchTotal ?? 0}`}
        />
        <Chip
          size="small"
          variant="outlined"
          label={`耗时 ${formatDuration(snapshot?.elapsedSecs ?? 0)}`}
        />
      </Box>
    </Box>
  );
}
