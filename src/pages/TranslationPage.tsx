import {
  Alert,
  Autocomplete,
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
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import TranslateIcon from '@mui/icons-material/Translate';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/api';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { StatusChip } from '@/components/common/StatusChip';
import { LogPanel } from '@/components/tasks/LogPanel';
import { TaskControls } from '@/components/tasks/TaskControls';
import { TaskProgress } from '@/components/tasks/TaskProgress';
import { ItemEditDialog } from '@/components/translation/ItemEditDialog';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAppStore } from '@/store/useAppStore';
import { useJobsStore } from '@/store/useJobsStore';
import type { GroupOption, ImportReport, ItemPage, ItemQuery, ItemView } from '@/types';
import { pickJsonFile, pickSavePath } from '@/utils/fileDialog';
import {
  errorMessage,
  fileStem,
  formatBytes,
  formatNumber,
  formatPercent,
} from '@/utils/format';

const DEFAULT_QUERY: ItemQuery = {
  page: 1,
  pageSize: 20,
  status: 'all',
  groupIndex: null,
  keyword: '',
};

const clampSx = {
  display: '-webkit-box',
  WebkitLineClamp: 4,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

export default function TranslationPage() {
  const summary = useAppStore((state) => state.summary);
  const applySummary = useAppStore((state) => state.applySummary);
  const refreshSummary = useAppStore((state) => state.refreshSummary);
  const notify = useAppStore((state) => state.notify);

  const snapshots = useJobsStore((state) => state.snapshots);
  const startJob = useJobsStore((state) => state.startJob);
  const stopJob = useJobsStore((state) => state.stopJob);
  const clearLogs = useJobsStore((state) => state.clearLogs);
  const busyAction = useJobsStore((state) => state.busyAction);

  const [query, setQuery] = useState<ItemQuery>(DEFAULT_QUERY);
  const [pageData, setPageData] = useState<ItemPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ItemView | null>(null);
  const [saving, setSaving] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);

  const debouncedKeyword = useDebouncedValue(query.keyword, 300);
  const translate = snapshots?.translate ?? null;
  const progressTick =
    translate?.phase === 'running' ? Math.floor(translate.done / 50) : (translate?.done ?? 0);

  const { page, pageSize, status, groupIndex } = query;

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listItems({
        page,
        pageSize,
        status,
        groupIndex,
        keyword: debouncedKeyword,
      });
      setPageData(data);
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, groupIndex, debouncedKeyword, notify]);

  useEffect(() => {
    void loadItems();
  }, [loadItems, progressTick, translate?.phase]);

  const selectedGroup = useMemo<GroupOption | null>(
    () => summary?.groups.find((group) => group.index === groupIndex) ?? null,
    [summary, groupIndex],
  );

  if (!summary) {
    return null;
  }

  const updateQuery = (patch: Partial<ItemQuery>) => {
    setQuery((current) => ({ ...current, ...patch }));
  };

  const handleSaveTranslation = async (translation: string) => {
    if (!editing) {
      return;
    }
    setSaving(true);
    try {
      const next = await api.setItemTranslation(
        editing.groupIndex,
        editing.indexInGroup,
        translation,
      );
      applySummary(next);
      setEditing(null);
      notify('success', '译文已保存');
      await loadItems();
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      const dest = await pickSavePath(
        `${fileStem(summary.fileName)}.${summary.targetLang}.json`,
        '导出译文 JSON',
      );
      if (!dest) {
        return;
      }
      setFileBusy(true);
      const result = await api.exportTranslation(dest);
      notify(
        'success',
        `已导出 ${formatNumber(result.itemCount)} 条文本到 ${result.path}（${formatBytes(
          result.bytes,
        )}）`,
      );
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setFileBusy(false);
    }
  };

  const handleImport = async () => {
    try {
      const picked = await pickJsonFile('选择译文 JSON');
      if (!picked) {
        return;
      }
      setFileBusy(true);
      const report = await api.importTranslations(picked.path, picked.text);
      setImportReport(report);
      await Promise.all([loadItems(), refreshSummary()]);
      notify(
        report.mismatched > 0 ? 'warning' : 'success',
        `导入完成：应用 ${formatNumber(report.applied)} 条，跳过 ${formatNumber(
          report.skipped,
        )} 条`,
      );
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setFileBusy(false);
    }
  };

  const handleStart = (restart: boolean) => {
    if (restart) {
      setRestartOpen(true);
      return;
    }
    void startJob('translate', false);
  };

  const items = pageData?.items ?? [];
  const percent = formatPercent(summary.doneCount, summary.itemCount);

  return (
    <>
      <PageHeader
        icon={<TranslateIcon />}
        title="翻译任务"
        description="按字符与条目上限自动分批，多批次并发执行；术语会注入匹配到的原文，失败条目可继续执行重试。"
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={<FileUploadOutlinedIcon />}
              onClick={() => void handleImport()}
              disabled={fileBusy}
            >
              导入译文
            </Button>
            <Button
              variant="contained"
              startIcon={<FileDownloadOutlinedIcon />}
              onClick={() => void handleExport()}
              disabled={fileBusy}
            >
              导出译文
            </Button>
          </>
        }
      />

      <Stack spacing={2.5}>
        <SectionCard
          title="批量翻译"
          subtitle="继续执行会跳过已完成条目，优先处理待处理与失败条目"
          action={
            <TaskControls
              snapshot={translate}
              startLabel="开始翻译"
              busy={busyAction !== null}
              onStart={handleStart}
              onStop={() => void stopJob('translate')}
            />
          }
        >
          <TaskProgress snapshot={translate} />

          {translate && translate.phase === 'completed' && translate.failed > 0 && (
            <Alert
              severity="warning"
              variant="outlined"
              sx={{ mt: 2 }}
              action={
                <Button size="small" onClick={() => void startJob('translate', false)}>
                  继续执行
                </Button>
              }
            >
              有 {translate.failed} 条文本失败，继续执行会保留已完成进度，只重试失败与未处理条目。
            </Alert>
          )}

          <Box sx={{ mt: 2 }}>
            <LogPanel
              logs={translate?.logs ?? []}
              onClear={() => void clearLogs('translate')}
            />
          </Box>
        </SectionCard>

        {importReport && (
          <Alert severity={importReport.mismatched > 0 ? 'warning' : 'success'} onClose={() => setImportReport(null)}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              译文导入结果
            </Typography>
            <Typography variant="body2">
              匹配分组 {importReport.matchedGroups} / {importReport.totalGroups}，应用{' '}
              {formatNumber(importReport.applied)} 条，跳过 {formatNumber(importReport.skipped)} 条，
              原文不匹配 {formatNumber(importReport.mismatched)} 条，未知分组{' '}
              {formatNumber(importReport.unknownGroups)} 个。
              {importReport.mismatched > 0 &&
                '不匹配的条目未被覆盖，请确认导入文件与当前源文件一致。'}
            </Typography>
          </Alert>
        )}

        <SectionCard
          title="原文与译文"
          subtitle={`共 ${formatNumber(summary.itemCount)} 条 · 覆盖率 ${percent}% · 修改立即保存`}
          action={
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              <Chip color="success" variant="outlined" label={`已完成 ${formatNumber(summary.doneCount)}`} />
              <Chip
                color={summary.failedCount > 0 ? 'error' : 'default'}
                variant="outlined"
                label={`失败 ${formatNumber(summary.failedCount)}`}
              />
              <Chip variant="outlined" label={`待处理 ${formatNumber(summary.pendingCount)}`} />
            </Box>
          }
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.25}
            sx={{ mb: 1.5, flexWrap: 'wrap', alignItems: { md: 'center' } }}
            useFlexGap
          >
            <TextField
              value={query.keyword}
              onChange={(event) => updateQuery({ keyword: event.target.value, page: 1 })}
              placeholder="搜索原文或译文"
              sx={{ width: { xs: '100%', md: 260 } }}
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
              label="状态"
              value={query.status}
              onChange={(event) =>
                updateQuery({ status: event.target.value as ItemQuery['status'], page: 1 })
              }
              sx={{ width: { xs: '100%', md: 130 } }}
            >
              <MenuItem value="all">全部状态</MenuItem>
              <MenuItem value="pending">待处理</MenuItem>
              <MenuItem value="done">已完成</MenuItem>
              <MenuItem value="failed">失败</MenuItem>
            </TextField>
            <Autocomplete
              options={summary.groups}
              value={selectedGroup}
              onChange={(_event, value) =>
                updateQuery({ groupIndex: value?.index ?? null, page: 1 })
              }
              getOptionLabel={(option) => `#${option.index} ${option.id}`}
              isOptionEqualToValue={(option, value) => option.index === value.index}
              renderOption={(props, option) => (
                <Box component="li" {...props} key={option.index}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', width: '100%' }}>
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {option.id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatNumber(option.count)}
                    </Typography>
                  </Box>
                </Box>
              )}
              renderInput={(params) => (
                <TextField {...params} label="分组" placeholder="全部分组" />
              )}
              sx={{ width: { xs: '100%', md: 260 } }}
            />
            <Box sx={{ flex: 1 }} />
            <Tooltip title="刷新当前列表">
              <span>
                <IconButton
                  aria-label="刷新条目列表"
                  onClick={() => void loadItems()}
                  disabled={loading}
                >
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          <Box sx={{ height: 3, mb: 1 }}>{loading && <LinearProgress />}</Box>

          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small" aria-label="原文与译文">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 88 }}>状态</TableCell>
                  <TableCell sx={{ width: '40%' }}>原文</TableCell>
                  <TableCell sx={{ width: '40%' }}>译文</TableCell>
                  <TableCell align="right" sx={{ width: 64 }}>
                    操作
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.key} hover>
                    <TableCell>
                      <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                        <StatusChip status={item.status} />
                        {item.manual && (
                          <Chip size="small" color="primary" variant="outlined" label="人工" />
                        )}
                        {item.skipped && (
                          <Chip size="small" color="warning" variant="outlined" label="超长跳过" />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {item.group} · 第 {item.indexInGroup + 1} 条
                      </Typography>
                      <Typography variant="body2" sx={clampSx} title={item.original}>
                        {item.original || '（空文本）'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {item.translation &&
                      !(item.status === 'pending' && item.translation === item.original) ? (
                        <Typography variant="body2" sx={clampSx} title={item.translation}>
                          {item.translation}
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.disabled">
                          未翻译
                        </Typography>
                      )}
                      {item.error && (
                        <Typography
                          variant="caption"
                          color="error.main"
                          display="block"
                          sx={{ mt: 0.5, wordBreak: 'break-word' }}
                        >
                          {item.error}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="编辑译文">
                        <span>
                          <IconButton
                            size="small"
                            aria-label={`编辑 ${item.group} 第 ${item.indexInGroup + 1} 条译文`}
                            onClick={() => setEditing(item)}
                            disabled={fileBusy}
                          >
                            <EditOutlinedIcon fontSize="small" />
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
                title={
                  query.keyword || query.status !== 'all' || groupIndex !== null
                    ? '没有匹配的条目'
                    : '还没有可显示的条目'
                }
                description={
                  query.keyword || query.status !== 'all' || groupIndex !== null
                    ? '尝试清空搜索条件、切换状态或选择其他分组。'
                    : '导入源文件后即可在这里查看原文与译文。'
                }
                compact
              />
            )}
          </TableContainer>

          <TablePagination
            component="div"
            count={pageData?.total ?? 0}
            page={Math.max(0, query.page - 1)}
            rowsPerPage={query.pageSize}
            rowsPerPageOptions={[10, 20, 50, 100]}
            onPageChange={(_event, nextPage) => updateQuery({ page: nextPage + 1 })}
            onRowsPerPageChange={(event) =>
              updateQuery({ pageSize: Number(event.target.value), page: 1 })
            }
            labelRowsPerPage="每页"
            labelDisplayedRows={({ from, to, count }) =>
              `${formatNumber(from)}-${formatNumber(to)} / ${formatNumber(count)}`
            }
          />
        </SectionCard>
      </Stack>

      <ItemEditDialog
        open={Boolean(editing)}
        item={editing}
        saving={saving}
        onClose={() => setEditing(null)}
        onSave={(translation) => void handleSaveTranslation(translation)}
      />

      <ConfirmDialog
        open={restartOpen}
        title="从头执行翻译"
        description="所有条目会重置为待处理，旧译文将作为参考随请求发送给模型重新翻译。此操作会覆盖当前译文，建议先导出备份。"
        confirmLabel="从头执行"
        danger
        loading={busyAction === 'start-translate'}
        onCancel={() => setRestartOpen(false)}
        onConfirm={() => {
          setRestartOpen(false);
          void startJob('translate', true);
        }}
      />
    </>
  );
}
