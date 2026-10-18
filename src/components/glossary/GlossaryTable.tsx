import {
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import SearchIcon from '@mui/icons-material/Search';
import TranslateIcon from '@mui/icons-material/Translate';

import type { GlossaryTerm, TermPage, TermQuery } from '@/types';
import { formatNumber } from '@/utils/format';

import { EmptyState } from '../common/EmptyState';

interface GlossaryTableProps {
  page: TermPage | null;
  query: TermQuery;
  loading: boolean;
  busy: boolean;
  onQueryChange: (patch: Partial<TermQuery>) => void;
  onAdd: () => void;
  onEdit: (term: GlossaryTerm) => void;
  onDelete: (term: GlossaryTerm) => void;
  onImport: () => void;
  onExport: () => void;
}

export function GlossaryTable({
  page,
  query,
  loading,
  busy,
  onQueryChange,
  onAdd,
  onEdit,
  onDelete,
  onImport,
  onExport,
}: GlossaryTableProps) {
  const items = page?.items ?? [];

  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.25}
        sx={{ mb: 1.5, alignItems: { md: 'center' }, flexWrap: 'wrap' }}
        useFlexGap
      >
        <TextField
          value={query.keyword}
          onChange={(event) => onQueryChange({ keyword: event.target.value, page: 1 })}
          placeholder="搜索原文、译文或备注"
          sx={{ width: { xs: '100%', md: 280 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          select
          label="筛选"
          value={query.filter}
          onChange={(event) =>
            onQueryChange({ filter: event.target.value as TermQuery['filter'], page: 1 })
          }
          sx={{ width: { xs: '100%', md: 150 } }}
        >
          <MenuItem value="all">全部术语</MenuItem>
          <MenuItem value="translated">已有译名</MenuItem>
          <MenuItem value="untranslated">缺少译名</MenuItem>
          <MenuItem value="manual">人工维护</MenuItem>
        </TextField>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={onAdd} disabled={busy}>
            新增术语
          </Button>
          <Button
            variant="outlined"
            startIcon={<FileDownloadOutlinedIcon />}
            onClick={onImport}
            disabled={busy}
          >
            导入
          </Button>
          <Button
            variant="outlined"
            startIcon={<FileUploadOutlinedIcon />}
            onClick={onExport}
            disabled={busy || (page?.total ?? 0) === 0}
          >
            导出
          </Button>
        </Box>
      </Stack>

      <Box sx={{ height: 3, mb: 1 }}>{loading && <LinearProgress />}</Box>

      <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small" aria-label="术语表">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '32%' }}>原文</TableCell>
              <TableCell sx={{ width: '32%' }}>译文</TableCell>
              <TableCell sx={{ width: '16%' }}>备注</TableCell>
              <TableCell sx={{ width: 90 }}>来源</TableCell>
              <TableCell align="right" sx={{ width: 96 }}>
                操作
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((term) => (
              <TableRow key={term.source} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {term.source}
                  </Typography>
                </TableCell>
                <TableCell>
                  {term.target ? (
                    <Typography
                      variant="body2"
                      sx={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
                    >
                      {term.target}
                    </Typography>
                  ) : (
                    <Typography variant="caption" color="text.disabled">
                      未翻译
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {term.note || '—'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={term.manual ? 'primary' : 'default'}
                    label={term.manual ? '人工' : 'AI'}
                  />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="编辑术语">
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`编辑术语 ${term.source}`}
                        onClick={() => onEdit(term)}
                        disabled={busy}
                      >
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="删除术语">
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`删除术语 ${term.source}`}
                        onClick={() => onDelete(term)}
                        disabled={busy}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {items.length === 0 && (
          <EmptyState
            icon={<TranslateIcon fontSize="inherit" />}
            title={query.keyword || query.filter !== 'all' ? '没有匹配的术语' : '术语表还是空的'}
            description={
              query.keyword || query.filter !== 'all'
                ? '尝试清空搜索条件或切换筛选方式。'
                : '运行术语收集任务自动抽取专有名词，也可以手动新增或导入参考术语表。'
            }
            compact
          />
        )}
      </TableContainer>

      <TablePagination
        component="div"
        count={page?.total ?? 0}
        page={Math.max(0, query.page - 1)}
        rowsPerPage={query.pageSize}
        rowsPerPageOptions={[10, 20, 50, 100]}
        onPageChange={(_event, nextPage) => onQueryChange({ page: nextPage + 1 })}
        onRowsPerPageChange={(event) =>
          onQueryChange({ pageSize: Number(event.target.value), page: 1 })
        }
        labelRowsPerPage="每页"
        labelDisplayedRows={({ from, to, count }) =>
          `${formatNumber(from)}-${formatNumber(to)} / ${formatNumber(count)}`
        }
        slotProps={{ actions: { nextButton: { 'aria-label': '下一页' } } }}
      />
    </Box>
  );
}
