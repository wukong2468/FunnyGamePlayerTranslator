import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { useEffect, useState } from 'react';

import type { GlossaryTerm } from '@/types';

interface TermDialogProps {
  open: boolean;
  term: GlossaryTerm | null;
  saving: boolean;
  onClose: () => void;
  onSave: (term: GlossaryTerm) => void;
}

export function TermDialog({ open, term, saving, onClose, onSave }: TermDialogProps) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }
    setSource(term?.source ?? '');
    setTarget(term?.target ?? '');
    setNote(term?.note ?? '');
    setError('');
  }, [open, term]);

  const handleSubmit = () => {
    const trimmed = source.trim();
    if (!trimmed) {
      setError('术语原文不能为空');
      return;
    }
    if ([...trimmed].length > 120) {
      setError('术语原文不能超过 120 个字符');
      return;
    }
    onSave({ source: trimmed, target: target.trim(), note: note.trim(), manual: true });
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{term ? '编辑术语' : '新增术语'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="原文"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setError('');
            }}
            error={Boolean(error)}
            helperText={error || '游戏原文中的完整词形，翻译时会按此匹配'}
            autoFocus
            fullWidth
          />
          <TextField
            label="译文"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            helperText="留空表示待补充；人工填写与导入的译名不会被 AI 覆盖"
            fullWidth
          />
          <TextField
            label="备注"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            helperText="例如：角色、地名、道具"
            fullWidth
          />
          <Alert severity="info" variant="outlined">
            术语修改会立即保存到当前项目工作区，并优先于后续 AI 收集结果。
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={saving}>
          取消
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}
