import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import HistoryIcon from '@mui/icons-material/History';
import TranslateIcon from '@mui/icons-material/Translate';
import { useCallback, useState } from 'react';

import { isDesktop } from '@/api';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { DropZone } from '@/components/files/DropZone';
import { RecentProjectList } from '@/components/files/RecentProjectList';
import { useFileDrop } from '@/hooks/useFileDrop';
import { useAppStore } from '@/store/useAppStore';
import type { ProjectSource } from '@/types';
import { pickJsonFile } from '@/utils/fileDialog';
import { formatNumber } from '@/utils/format';

const DEMO_PATH = 'demo://FunnyGameTranslations.json';

const STEPS = [
  { title: '导入源文件', text: '解析分组、条目与现有译文' },
  { title: '收集术语', text: '并发抽取人名、地名与道具名' },
  { title: '批量翻译', text: '按批次注入术语并校验结果' },
  { title: '导出回填', text: '保持源文件结构，直接替换游戏数据' },
];

export default function WelcomePage() {
  const summary = useAppStore((state) => state.summary);
  const recent = useAppStore((state) => state.recent);
  const appInfo = useAppStore((state) => state.appInfo);
  const opening = useAppStore((state) => state.opening);
  const openProject = useAppStore((state) => state.openProject);
  const removeRecent = useAppStore((state) => state.removeRecent);
  const notify = useAppStore((state) => state.notify);
  const [error, setError] = useState('');

  const handleSource = useCallback(
    async (source: ProjectSource) => {
      setError('');
      if (!source.path.toLowerCase().endsWith('.json') && !source.text) {
        setError('请选择 FunnyGameTranslations.json 文件');
        return;
      }
      await openProject(source);
    },
    [openProject],
  );

  const active = useFileDrop(handleSource, true);

  const handlePick = async () => {
    setError('');
    try {
      const picked = await pickJsonFile('选择 FunnyGameTranslations.json');
      if (picked) {
        await handleSource({ path: picked.path, text: picked.text });
      }
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : '读取文件失败');
    }
  };

  const handleOpenRecent = async (path: string, exists: boolean) => {
    if (!exists) {
      notify('warning', '该文件已被移动或删除，请重新选择文件');
      return;
    }
    setError('');
    await openProject({ path });
  };

  return (
    <>
      <PageHeader
        icon={<TranslateIcon />}
        title="FunnyGamePlayer 文本翻译工具"
        description="读取游戏导出的翻译文件，自动整理术语并调用任意 OpenAI 兼容接口完成批量翻译，最后导出可直接回填的 JSON。"
      />

      {opening && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 7fr) minmax(0, 5fr)' },
          alignItems: 'start',
        }}
      >
        <Stack spacing={2.5}>
          <Paper
            variant="outlined"
            sx={{
              p: { xs: 2.5, md: 3 },
              background: (theme) =>
                `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.12)}, ${alpha(
                  theme.palette.secondary.main,
                  0.06,
                )} 55%, transparent)`,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
              <AutoAwesomeOutlinedIcon color="primary" fontSize="small" />
              <Typography variant="subtitle2" color="primary.main">
                本地优先 · 断点续传
              </Typography>
            </Stack>
            <Typography variant="h5" sx={{ mb: 1 }}>
              从源文件到可直接回填的译文
            </Typography>
            <Typography variant="body2" color="text.secondary">
              项目数据、术语表与任务进度保存在本机工作区，中断或重启后可继续执行；API Key
              仅保存在本地，不会写入导出文件或日志。
            </Typography>
            <Box
              sx={{
                mt: 2.5,
                display: 'grid',
                gap: 1.5,
                gridTemplateColumns: {
                  xs: 'repeat(2, minmax(0, 1fr))',
                  xl: 'repeat(4, minmax(0, 1fr))',
                },
              }}
            >
              {STEPS.map((step, index) => (
                <Box key={step.title}>
                  <Typography variant="caption" color="primary.main" sx={{ fontWeight: 700 }}>
                    0{index + 1}
                  </Typography>
                  <Typography variant="subtitle2" display="block">
                    {step.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {step.text}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Paper>

          <DropZone active={active} disabled={opening} onPick={handlePick} />

          {!isDesktop && (
            <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2">浏览器预览模式</Typography>
                <Typography variant="caption" color="text.secondary">
                  当前使用内存 Mock 数据，可完整体验全部界面与任务流程；不会发起真实 AI
                  请求。也可以直接拖入本地 JSON 文件进行解析。
                </Typography>
              </Box>
              <Button
                variant="outlined"
                onClick={() => void handleSource({ path: DEMO_PATH })}
                disabled={opening}
              >
                加载演示项目
              </Button>
            </Paper>
          )}
        </Stack>

        <Stack spacing={2.5}>
          <SectionCard
            title="最近项目"
            subtitle="打开后可恢复上次的术语表、译文与任务进度"
            action={
              <Chip
                size="small"
                variant="outlined"
                icon={<HistoryIcon />}
                label={`${recent.length} 个`}
              />
            }
            noPadding
          >
            {recent.length === 0 ? (
              <EmptyState
                icon={<HistoryIcon fontSize="inherit" />}
                title="还没有最近项目"
                description="导入 FunnyGameTranslations.json 后，这里会显示项目进度，方便随时继续。"
                compact
              />
            ) : (
              <RecentProjectList
                items={recent}
                busy={opening}
                onOpen={(item) => void handleOpenRecent(item.sourcePath, item.exists)}
                onRemove={(item) => void removeRecent(item.sourcePath)}
              />
            )}
          </SectionCard>

          {summary && (
            <Alert
              severity="success"
              variant="outlined"
              action={
                <Button size="small" onClick={() => useAppStore.getState().navigate('config')}>
                  查看项目
                </Button>
              }
            >
              当前已加载 {summary.fileName}，共 {formatNumber(summary.itemCount)} 条文本。
            </Alert>
          )}

          <SectionCard title="数据存放位置" subtitle="所有数据仅保存在本机">
            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
              {appInfo?.dataDir ?? '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              设置、工作区、最近项目均位于该目录；关键文件使用临时文件 + 原子替换写入。
            </Typography>
          </SectionCard>
        </Stack>
      </Box>
    </>
  );
}
