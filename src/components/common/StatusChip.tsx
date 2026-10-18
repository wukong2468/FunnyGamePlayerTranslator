import { Chip } from '@mui/material';

import type { ItemStatus, JobPhase } from '@/types';
import { PHASE_LABELS, STATUS_LABELS } from '@/types';

type StatusValue = ItemStatus | JobPhase;

const ITEM_COLORS: Record<ItemStatus, 'default' | 'success' | 'error'> = {
  pending: 'default',
  done: 'success',
  failed: 'error',
  skipped: 'default',
};

const ITEM_OUTLINED: Record<ItemStatus, boolean> = {
  pending: true,
  done: false,
  failed: false,
  skipped: true,
};

const PHASE_COLORS: Record<JobPhase, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  idle: 'default',
  running: 'info',
  paused: 'warning',
  interrupted: 'warning',
  completed: 'success',
  failed: 'error',
};

export function StatusChip({ status, label }: { status: StatusValue; label?: string }) {
  if (status in STATUS_LABELS) {
    const itemStatus = status as ItemStatus;
    return (
      <Chip
        size="small"
        color={ITEM_COLORS[itemStatus]}
        variant={ITEM_OUTLINED[itemStatus] ? 'outlined' : 'filled'}
        label={label ?? STATUS_LABELS[itemStatus]}
      />
    );
  }
  const phase = status as JobPhase;
  return (
    <Chip
      size="small"
      color={PHASE_COLORS[phase]}
      variant={phase === 'idle' ? 'outlined' : 'filled'}
      label={label ?? PHASE_LABELS[phase]}
    />
  );
}
