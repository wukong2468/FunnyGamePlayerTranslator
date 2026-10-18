import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
} from '@mui/material';
import { useEffect, useState } from 'react';

type ImportMode = 'merge' | 'replace';

interface ImportGlossaryDialogProps {
  open: boolean;
  totalTerms: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (mode: ImportMode) => void;
}

export function ImportGlossaryDialog({
  open,
  totalTerms,
  busy,
  onClose,
  onConfirm,
}: ImportGlossaryDialogProps) {
  const [mode, setMode] = useState<ImportMode>('merge');

  useEffect(() => {
    if (open) {
      setMode('merge');
    }
  }, [open]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>导入术语表</DialogTitle>
      <DialogContent>
        <DialogContentText component="div" variant="body2">
          支持 <code>{'{"terms": [...]}'}</code> 结构与纯数组，兼容 original / translation 等字段别名。
        </DialogContentText>
        <FormControl sx={{ mt: 2 }}>
          <RadioGroup
            value={mode}
            onChange={(event) => setMode(event.target.value as ImportMode)}
          >
            <FormControlLabel
              value="merge"
              control={<Radio size="small" />}
              label="合并到现有术语表（推荐）"
            />
            <FormControlLabel
              value="replace"
              control={<Radio size="small" />}
              label="替换现有术语表"
            />
          </RadioGroup>
        </FormControl>
        <Stack sx={{ mt: 1 }} spacing={1}>
          <Alert severity="info" variant="outlined">
            合并时不会覆盖已有的人工译名；同名词条会以导入文件为参考并保留人工校对结果。
          </Alert>
          {mode === 'replace' && (
            <Alert severity="warning" variant="outlined">
              替换会清空当前 {totalTerms} 条术语，导入完成后无法撤销。
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={busy}>
          取消
        </Button>
        <Button onClick={() => onConfirm(mode)} variant="contained" disabled={busy}>
          选择文件并导入
        </Button>
      </DialogActions>
    </Dialog>
  );
}
