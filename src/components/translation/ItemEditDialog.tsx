import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';

import type { ItemView } from '@/types';
import { MONO_FONT_STACK } from '@/theme';
import { formatNumber } from '@/utils/format';

interface ItemEditDialogProps {
  open: boolean;
  item: ItemView | null;
  saving: boolean;
  onClose: () => void;
  onSave: (translation: string) => void;
}

export function ItemEditDialog({ open, item, saving, onClose, onSave }: ItemEditDialogProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) {
      setValue(item?.translation ?? '');
    }
  }, [open, item]);

  const lines = value.split('\n').length;
  const mismatch = item ? item.segmentCount > 1 && lines !== item.segmentCount : false;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>编辑译文</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              原文{item ? ` · 分组 ${item.group} · 第 ${item.indexInGroup + 1} 条` : ''}
            </Typography>
            <Box
              sx={{
                mt: 0.5,
                p: 1.5,
                bgcolor: 'action.hover',
                borderRadius: 1,
                maxHeight: 200,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: MONO_FONT_STACK,
                fontSize: 12.5,
                lineHeight: 1.65,
              }}
            >
              {item?.original || '（空）'}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, mt: 1, flexWrap: 'wrap' }}>
              <Chip size="small" variant="outlined" label={`${formatNumber([...(item?.original ?? '')].length)} 字符`} />
              {item && item.segmentCount > 1 && (
                <Chip size="small" variant="outlined" label={`原文 ${item.segmentCount} 段`} />
              )}
              {item?.hasReference && (
                <Chip size="small" color="info" variant="outlined" label="包含旧译文参考" />
              )}
              {item?.skipped && <Chip size="small" color="warning" variant="outlined" label="曾被跳过" />}
            </Box>
          </Box>

          <TextField
            label="译文"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            multiline
            minRows={5}
            maxRows={14}
            fullWidth
            autoFocus
            helperText={
              item && item.segmentCount > 1
                ? `原文分为 ${item.segmentCount} 段，请使用换行符分隔对应译文（当前 ${lines} 段）`
                : '留空会将条目重新标记为待处理'
            }
          />

          {mismatch && (
            <Alert severity="warning" variant="outlined">
              译文分段数量与原文不一致，将整体写入首段并把其余分段置空。建议按原文分行填写。
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={saving}>
          取消
        </Button>
        <Button variant="contained" onClick={() => onSave(value)} disabled={saving}>
          保存译文
        </Button>
      </DialogActions>
    </Dialog>
  );
}
