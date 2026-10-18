import { Box, Button, Paper, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import FileOpenOutlinedIcon from '@mui/icons-material/FileOpenOutlined';

interface DropZoneProps {
  active: boolean;
  disabled?: boolean;
  onPick: () => void;
}

export function DropZone({ active, disabled = false, onPick }: DropZoneProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 3, md: 4 },
        textAlign: 'center',
        borderStyle: 'dashed',
        borderWidth: 2,
        borderColor: active ? 'primary.main' : 'divider',
        bgcolor: active ? 'action.hover' : 'background.paper',
        transition: 'border-color 120ms ease, background-color 120ms ease',
      }}
    >
      <Box
        sx={{
          width: 56,
          height: 56,
          mx: 'auto',
          mb: 1.5,
          borderRadius: 3,
          display: 'grid',
          placeItems: 'center',
          bgcolor: active ? 'primary.main' : 'action.hover',
          color: active ? 'primary.contrastText' : 'text.secondary',
        }}
      >
        <UploadFileIcon sx={{ fontSize: '1.75rem' }} />
      </Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {active ? '松开即可导入文件' : '将 FunnyGameTranslations.json 拖到此处'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
        也可以使用文件选择器导入。
      </Typography>
      <Button
        variant="contained"
        startIcon={<FileOpenOutlinedIcon />}
        onClick={onPick}
        disabled={disabled}
      >
        选择 JSON 文件
      </Button>
    </Paper>
  );
}
