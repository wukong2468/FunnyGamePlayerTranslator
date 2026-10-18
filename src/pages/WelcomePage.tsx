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

import { api, isDesktop } from '@/api';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { DropZone } from '@/components/files/DropZone';
import { ProjectList } from '@/components/files/ProjectList';
import { useFileDrop } from '@/hooks/useFileDrop';
import { useAppStore } from '@/store/useAppStore';
import type { ProjectEntry, ProjectSource } from '@/types';
import { pickJsonFile } from '@/utils/fileDialog';

const DEMO_PATH = 'demo://FunnyGameTranslations.json';

interface ReloadTarget {
  source: ProjectSource;
  fileName: string;
}

const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() || path;

/** 源文件存在且内容与该项目的记录不一致时返回 true。 */
async function sourceChanged(path: string): Promise<boolean> {
  if (!isDesktop || !path || path.startsWith('demo://')) {
    return false;
  }
  try {
    return (await api.projectSourceStatus(path)).changed;
  } catch {
    return false;
  }
}

const STEPS = [
  { title: '导入源文件', text: '解析分组、条目与现有译文' },
  { title: '收集术语', text: '并发抽取人名、地名与道具名' },
  { title: '批量翻译', text: '按批次注入术语并校验结果' },
  { title: '导出回填', text: '保持源文件结构，直接替换数据' },
];

export default function WelcomePage() {
  const projects = useAppStore((state) => state.projects);
  const opening = useAppStore((state) => state.opening);
  const openProject = useAppStore((state) => state.openProject);
  const [error, setError] = useState('');
  // 源文件内容变化时，先询问是否按源文件重新加载
  const [reloadTarget, setReloadTarget] = useState<ReloadTarget | null>(null);

  const handleSource = useCallback(
    async (source: ProjectSource) => {
      setError('');
      if (!source.path.toLowerCase().endsWith('.json') && !source.text) {
        setError('请选择 FunnyGameTranslations.json 文件');
        return;
      }
      if (await sourceChanged(source.path)) {
        setReloadTarget({ source, fileName: fileNameOf(source.path) });
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

  const handleOpenProject = async (item: ProjectEntry) => {
    setError('');
    if (await sourceChanged(item.sourcePath)) {
      setReloadTarget({ source: { path: item.sourcePath }, fileName: item.fileName });
      return;
    }
    await openProject({ path: item.sourcePath });
  };

  const closeReloadDialog = (reloadSource: boolean) => {
    const target = reloadTarget;
    setReloadTarget(null);
    if (target) {
      void openProject(target.source, reloadSource);
    }
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
            title="所有项目"
            action={
              <Chip
                size="small"
                variant="outlined"
                icon={<HistoryIcon />}
                label={`${projects.length} 个`}
              />
            }
            noPadding
          >
            {projects.length === 0 ? (
              <EmptyState
                icon={<HistoryIcon fontSize="inherit" />}
                title="还没有项目"
                description="导入 FunnyGameTranslations.json 后，项目会保存在本机工作区，可随时继续。"
                compact
              />
            ) : (
              <ProjectList
                items={projects}
                busy={opening}
                onOpen={(item) => void handleOpenProject(item)}
              />
            )}
          </SectionCard>
        </Stack>
      </Box>

      <ConfirmDialog
        open={Boolean(reloadTarget)}
        title="源文件已发生变化"
        description={
          <>
            {reloadTarget?.fileName ?? ''} 的内容与项目记录不一致。
            <br />
            重新加载会按源文件重建条目：原文未变化且已完成的译文会保留，失败与未处理的条目重置为待处理，
            源文件中已不存在的条目连同译文一并移除；术语表与术语收集进度保留。
            <br />
            使用项目内数据则继续用工作区里保存的副本。
          </>
        }
        confirmLabel="重新加载文件"
        cancelLabel="使用项目内数据"
        danger
        loading={opening}
        onCancel={() => closeReloadDialog(false)}
        onConfirm={() => closeReloadDialog(true)}
      />
    </>
  );
}
