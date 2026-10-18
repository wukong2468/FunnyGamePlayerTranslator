import { Box, Button, Tooltip } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';

import type { JobSnapshot } from '@/types';

interface TaskControlsProps {
  snapshot: JobSnapshot | null;
  startLabel: string;
  busy: boolean;
  onStart: (restart: boolean) => void;
  onStop: () => void;
}

export function TaskControls({
  snapshot,
  startLabel,
  busy,
  onStart,
  onStop,
}: TaskControlsProps) {
  const phase = snapshot?.phase ?? 'idle';
  const running = phase === 'running';
  const hasProgress = (snapshot?.done ?? 0) + (snapshot?.failed ?? 0) > 0;
  const pendingWork = (snapshot?.pending ?? 0) > 0 || (snapshot?.failed ?? 0) > 0;
  const canResume = phase !== 'idle' && pendingWork;
  const primaryLabel = running ? '中断任务' : canResume ? '继续执行' : startLabel;

  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      {running ? (
        <Button
          variant="contained"
          color="warning"
          startIcon={<StopCircleOutlinedIcon />}
          onClick={onStop}
          disabled={busy}
        >
          中断任务
        </Button>
      ) : (
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          onClick={() => onStart(false)}
          disabled={busy || (phase === 'completed' && !pendingWork)}
        >
          {primaryLabel}
        </Button>
      )}
      <Tooltip title="重置本次任务状态并重新执行；已完成译文会作为参考交给模型">
        <span>
          <Button
            variant="outlined"
            startIcon={<ReplayIcon />}
            onClick={() => onStart(true)}
            disabled={busy || running || (phase === 'idle' && !hasProgress)}
          >
            从头执行
          </Button>
        </span>
      </Tooltip>
    </Box>
  );
}
