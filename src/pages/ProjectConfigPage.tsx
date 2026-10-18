import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TranslateIcon from '@mui/icons-material/Translate';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import { useState, type ReactNode } from 'react';

import { api } from '@/api';
import { InfoList } from '@/components/common/InfoList';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { StatisticsGrid, type StatItem } from '@/components/statistics/StatisticsGrid';
import { ImportGlossaryDialog } from '@/components/glossary/ImportGlossaryDialog';
import { useAppStore } from '@/store/useAppStore';
import { useJobsStore } from '@/store/useJobsStore';
import { LANGUAGE_OPTIONS, PHASE_LABELS } from '@/types';
import { pickJsonFile, pickSavePath } from '@/utils/fileDialog';
import { errorMessage, fileStem, formatDateTime, formatNumber, formatPercent } from '@/utils/format';

type CheckStatus = 'ok' | 'warn' | 'info';

function CheckRow({
  status,
  title,
  detail,
  action,
}: {
  status: CheckStatus;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  const icon =
    status === 'ok' ? (
      <CheckCircleOutlineIcon fontSize="small" color="success" />
    ) : status === 'warn' ? (
      <ErrorOutlineIcon fontSize="small" color="warning" />
    ) : (
      <InfoOutlinedIcon fontSize="small" color="info" />
    );
  return (
    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', py: 0.9 }}>
      <Box sx={{ mt: '1px', flex: 'none' }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
          {detail}
        </Typography>
      </Box>
      {action}
    </Box>
  );
}

export default function ProjectConfigPage() {
  const summary = useAppStore((state) => state.summary);
  const settings = useAppStore((state) => state.settings);
  const setLanguages = useAppStore((state) => state.setLanguages);
  const navigate = useAppStore((state) => state.navigate);
  const notify = useAppStore((state) => state.notify);
  const refreshSummary = useAppStore((state) => state.refreshSummary);
  const snapshots = useJobsStore((state) => state.snapshots);

  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!summary) {
    return null;
  }

  const percent = formatPercent(summary.doneCount, summary.itemCount - summary.skippedCount);
  const running = snapshots?.translate.phase === 'running';
  const glossaryRunning = snapshots?.glossary.phase === 'running';

  const stats: StatItem[] = [
    { label: '分组', value: formatNumber(summary.groupCount), icon: <TuneOutlinedIcon /> },
    { label: '文本条目', value: formatNumber(summary.itemCount), icon: <TranslateIcon /> },
    { label: '源文字符数', value: formatNumber(summary.charCount), icon: <InfoOutlinedIcon /> },
    {
      label: '已翻译',
      value: formatNumber(summary.doneCount),
      hint: `覆盖率 ${percent}%`,
      color: 'success',
      icon: <CheckCircleOutlineIcon />,
    },
    {
      label: '待处理',
      value: formatNumber(summary.pendingCount),
      color: 'warning',
      icon: <PlayArrowIcon />,
    },
    {
      label: '失败',
      value: formatNumber(summary.failedCount),
      color: summary.failedCount > 0 ? 'error' : 'default',
      icon: <ErrorOutlineIcon />,
    },
    {
      label: '无需翻译',
      value: formatNumber(summary.skippedCount),
      hint: '纯数字、符号或空条目',
      icon: <InfoOutlinedIcon />,
    },
    {
      label: '术语表',
      value: formatNumber(summary.glossaryCount),
      hint: `已有译名 ${formatNumber(summary.translatedGlossaryCount)}`,
      color: 'info',
      icon: <MenuBookOutlinedIcon />,
    },
    {
      label: '翻译批次',
      value: snapshots?.translate.batchTotal ?? 0,
      hint: `已处理 ${snapshots?.translate.batchDone ?? 0}`,
      color: 'default',
      icon: <TuneOutlinedIcon />,
    },
  ];

  const translateJob = snapshots?.translate;
  const glossaryJob = snapshots?.glossary;

  const handleImportGlossary = async (mode: 'merge' | 'replace') => {
    try {
      const picked = await pickJsonFile('选择术语表 JSON');
      if (!picked) {
        return;
      }
      setBusy(true);
      const report = await api.importGlossary(picked.path, mode, picked.text);
      await refreshSummary();
      setImportOpen(false);
      notify(
        'success',
        `术语导入完成：新增 ${report.added} 条，更新 ${report.updated} 条，跳过 ${report.skipped} 条`,
      );
      if (report.conflicts.length > 0) {
        notify('warning', `有 ${report.conflicts.length} 条冲突已保留人工译名`);
      }
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleExportGlossary = async () => {
    try {
      const dest = await pickSavePath(`${fileStem(summary.fileName)}.glossary.json`, '导出术语表');
      if (!dest) {
        return;
      }
      setBusy(true);
      const path = await api.exportGlossary(dest);
      notify('success', `术语表已导出到 ${path}`);
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleSwapLanguages = () => {
    if (running || glossaryRunning) {
      notify('warning', '任务执行中无法切换语言，请先中断任务');
      return;
    }
    void setLanguages(summary.targetLang, summary.sourceLang);
  };

  return (
    <>
      <PageHeader
        icon={<TuneOutlinedIcon />}
        title="翻译配置"
        description="确认源文件信息、语言方向与参考术语表，然后开始术语收集或直接进入翻译任务。"
        actions={
          <>
            <Button variant="outlined" startIcon={<SettingsOutlinedIcon />} onClick={() => navigate('settings')}>
              接口设置
            </Button>
            <Button
              variant="contained"
              startIcon={<MenuBookOutlinedIcon />}
              onClick={() => navigate('glossary')}
            >
              开始术语收集
            </Button>
            <Button
              variant="outlined"
              startIcon={<TranslateIcon />}
              onClick={() => navigate('translate')}
            >
              进入翻译任务
            </Button>
          </>
        }
      />

      <Stack spacing={2.5}>
        {translateJob && translateJob.phase !== 'idle' && translateJob.phase !== 'completed' && (
          <Alert
            severity={translateJob.phase === 'running' ? 'info' : 'warning'}
            variant="outlined"
            action={
              <Button size="small" onClick={() => navigate('translate')}>
                {translateJob.phase === 'running' ? '查看进度' : '继续执行'}
              </Button>
            }
          >
            翻译任务：{PHASE_LABELS[translateJob.phase]} — {translateJob.message || '暂无进度信息'}
          </Alert>
        )}
        {glossaryJob && glossaryJob.phase !== 'idle' && glossaryJob.phase !== 'completed' && (
          <Alert
            severity={glossaryJob.phase === 'running' ? 'info' : 'warning'}
            variant="outlined"
            action={
              <Button size="small" onClick={() => navigate('glossary')}>
                {glossaryJob.phase === 'running' ? '查看进度' : '继续收集'}
              </Button>
            }
          >
            术语收集：{PHASE_LABELS[glossaryJob.phase]} — {glossaryJob.message || '暂无进度信息'}
          </Alert>
        )}

        <StatisticsGrid items={stats} columns={4} />

        <Box
          sx={{
            display: 'grid',
            gap: 2.5,
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 7fr) minmax(0, 5fr)' },
            alignItems: 'start',
          }}
        >
          <Stack spacing={2.5}>
            <SectionCard title="源文件" subtitle="导出的译文会保持相同的分组与条目结构">
              <InfoList
                items={[
                  { label: '文件名', value: summary.fileName },
                  { label: '源文件路径', value: summary.sourcePath },
                  { label: '工作区', value: summary.workspacePath },
                  { label: '最近保存', value: formatDateTime(summary.updatedAt) },
                  {
                    label: '源文件语言',
                    value:
                      LANGUAGE_OPTIONS.find((option) => option.value === summary.sourceLang)?.label ??
                      summary.sourceLang,
                  },
                  {
                    label: '目标语言',
                    value:
                      LANGUAGE_OPTIONS.find((option) => option.value === summary.targetLang)?.label ??
                      summary.targetLang,
                  },
                ]}
              />
            </SectionCard>

            <SectionCard
              title="语言方向"
              subtitle="修改后会立即保存到项目工作区，并作为提示词与术语译名的依据"
            >
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: '1fr', sm: '1fr auto 1fr' },
                  alignItems: 'center',
                }}
              >
                <TextField
                  select
                  label="源语言"
                  value={summary.sourceLang}
                  onChange={(event) => void setLanguages(event.target.value, summary.targetLang)}
                  disabled={running || glossaryRunning}
                  fullWidth
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Tooltip title="交换源语言与目标语言">
                  <span>
                    <IconButton
                      aria-label="交换源语言与目标语言"
                      onClick={handleSwapLanguages}
                      disabled={running || glossaryRunning}
                    >
                      <SwapHorizIcon />
                    </IconButton>
                  </span>
                </Tooltip>
                <TextField
                  select
                  label="目标语言"
                  value={summary.targetLang}
                  onChange={(event) => void setLanguages(summary.sourceLang, event.target.value)}
                  disabled={running || glossaryRunning}
                  fullWidth
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
                已经与原文相同的条目视为“待处理”；导出时会写入 translation_sequence 字段。
              </Typography>
            </SectionCard>

            <SectionCard
              title="参考术语表"
              subtitle="导入参考译名可在翻译前统一专有名词，人工维护的译名不会被 AI 覆盖"
              action={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FileUploadOutlinedIcon />}
                    onClick={() => setImportOpen(true)}
                    disabled={busy}
                  >
                    导入
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FileDownloadOutlinedIcon />}
                    onClick={() => void handleExportGlossary()}
                    disabled={busy || summary.glossaryCount === 0}
                  >
                    导出
                  </Button>
                </Box>
              }
            >
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip label={`共 ${formatNumber(summary.glossaryCount)} 条术语`} color="primary" variant="outlined" />
                <Chip label={`已有译名 ${formatNumber(summary.translatedGlossaryCount)}`} variant="outlined" />
                {summary.glossaryCount === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    尚未收集术语，翻译时不会注入术语表。
                  </Typography>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
                支持 {"{ terms: [...] }"} 结构与 original / translation 等常见字段别名；导入前会先校验再合并。
              </Typography>
            </SectionCard>
          </Stack>

          <Stack spacing={2.5}>
            <SectionCard title="配置检查" subtitle="正式翻译前的关键项">
              {settings ? (
                <Stack divider={<Divider flexItem />}>
                  <CheckRow
                    status={settings.api.baseUrl && settings.api.model ? 'ok' : 'warn'}
                    title="AI 接口"
                    detail={
                      settings.api.baseUrl && settings.api.model
                        ? `${settings.api.model} · ${settings.api.baseUrl}`
                        : '尚未配置 API 地址或模型'
                    }
                    action={
                      <Button size="small" onClick={() => navigate('settings')}>
                        设置
                      </Button>
                    }
                  />
                  <CheckRow
                    status={settings.api.hasApiKey ? 'ok' : 'info'}
                    title="API Key"
                    detail={
                      settings.api.hasApiKey
                        ? `已保存（${settings.api.apiKeyMasked}）`
                        : '未配置；使用本地部署模型时可忽略'
                    }
                  />
                  <CheckRow
                    status="ok"
                    title="翻译批次"
                    detail={`并发 ${settings.translation.concurrency} · 单批 ${formatNumber(
                      settings.translation.maxCharsPerBatch,
                    )} 字 / ${settings.translation.maxItemsPerBatch} 条 · 重试 ${settings.translation.retryTimes} 次`}
                  />
                  <CheckRow
                    status={summary.glossaryCount > 0 ? 'ok' : 'info'}
                    title="术语表"
                    detail={
                      summary.glossaryCount > 0
                        ? `已收集 ${formatNumber(summary.glossaryCount)} 条术语`
                        : '术语表为空，可先运行术语收集'
                    }
                  />
                  <CheckRow
                    status={summary.pendingCount + summary.failedCount > 0 ? 'ok' : 'warn'}
                    title="待翻译条目"
                    detail={
                      summary.pendingCount + summary.failedCount > 0
                        ? `${formatNumber(summary.pendingCount)} 条待处理，${formatNumber(
                            summary.failedCount,
                          )} 条失败`
                        : '所有条目均已完成，可从头执行重新翻译'
                    }
                  />
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  正在读取设置…
                </Typography>
              )}
            </SectionCard>

            <SectionCard title="下一步" subtitle="推荐流程">
              <Stack spacing={1.25}>
                <Button
                  variant="contained"
                  startIcon={<MenuBookOutlinedIcon />}
                  onClick={() => navigate('glossary')}
                  fullWidth
                >
                  1. 收集并校对术语
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<TranslateIcon />}
                  onClick={() => navigate('translate')}
                  fullWidth
                >
                  2. 执行批量翻译
                </Button>
                <Button
                  variant="text"
                  startIcon={<SettingsOutlinedIcon />}
                  onClick={() => navigate('settings')}
                  fullWidth
                >
                  调整接口与翻译参数
                </Button>
              </Stack>
              <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                建议先用较小的单批上限试跑，确认译名与格式无误后再全量执行。
              </Alert>
            </SectionCard>
          </Stack>
        </Box>
      </Stack>

      <ImportGlossaryDialog
        open={importOpen}
        totalTerms={summary.glossaryCount}
        busy={busy}
        onClose={() => setImportOpen(false)}
        onConfirm={(mode) => void handleImportGlossary(mode)}
      />
    </>
  );
}
