import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/api';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { GlossaryTable } from '@/components/glossary/GlossaryTable';
import { ImportGlossaryDialog } from '@/components/glossary/ImportGlossaryDialog';
import { TermDialog } from '@/components/glossary/TermDialog';
import { LogPanel } from '@/components/tasks/LogPanel';
import { TaskControls } from '@/components/tasks/TaskControls';
import { TaskProgress } from '@/components/tasks/TaskProgress';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAppStore } from '@/store/useAppStore';
import { useJobsStore } from '@/store/useJobsStore';
import type { GlossaryTerm, TermPage, TermQuery } from '@/types';
import { pickJsonFile, pickSavePath } from '@/utils/fileDialog';
import { errorMessage, fileStem, formatNumber } from '@/utils/format';

const DEFAULT_QUERY: TermQuery = {
  page: 1,
  pageSize: 20,
  keyword: '',
  filter: 'all',
};

export default function GlossaryPage() {
  const summary = useAppStore((state) => state.summary);
  const appSummary = useAppStore((state) => state.applySummary);
  const refreshSummary = useAppStore((state) => state.refreshSummary);
  const notify = useAppStore((state) => state.notify);

  const snapshots = useJobsStore((state) => state.snapshots);
  const startJob = useJobsStore((state) => state.startJob);
  const stopJob = useJobsStore((state) => state.stopJob);
  const clearLogs = useJobsStore((state) => state.clearLogs);
  const busyAction = useJobsStore((state) => state.busyAction);

  const [query, setQuery] = useState<TermQuery>(DEFAULT_QUERY);
  const [pageData, setPageData] = useState<TermPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<GlossaryTerm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GlossaryTerm | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);

  const debouncedKeyword = useDebouncedValue(query.keyword, 300);
  const glossarySnapshot = snapshots?.glossary ?? null;
  const jobDone = glossarySnapshot?.done ?? 0;

  const { page, pageSize, filter } = query;

  const loadTerms = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listTerms({ page, pageSize, filter, keyword: debouncedKeyword });
      setPageData(data);
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filter, debouncedKeyword, notify]);

  useEffect(() => {
    void loadTerms();
  }, [loadTerms, jobDone]);

  if (!summary) {
    return null;
  }

  const updateQuery = (patch: Partial<TermQuery>) => {
    setQuery((current) => ({ ...current, ...patch }));
  };

  const handleSaveTerm = async (term: GlossaryTerm) => {
    setSaving(true);
    try {
      const result = await api.saveTerm(term);
      appSummary(result.summary);
      setDialogOpen(false);
      setEditingTerm(null);
      notify('success', `术语「${result.term.source}」已保存`);
      await loadTerms();
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      const next = await api.deleteTerms([deleteTarget.source]);
      appSummary(next);
      notify('info', `已删除术语「${deleteTarget.source}」`);
      setDeleteTarget(null);
      await loadTerms();
      await refreshSummary();
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = async () => {
    try {
      const dest = await pickSavePath(`${fileStem(summary.fileName)}.glossary.json`, '导出术语表');
      if (!dest) {
        return;
      }
      setFileBusy(true);
      const path = await api.exportGlossary(dest);
      notify('success', `术语表已导出到 ${path}`);
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setFileBusy(false);
    }
  };

  const handleImport = async (mode: 'merge' | 'replace') => {
    try {
      const picked = await pickJsonFile('选择术语表 JSON');
      if (!picked) {
        return;
      }
      setFileBusy(true);
      const report = await api.importGlossary(picked.path, mode, picked.text);
      setImportOpen(false);
      await Promise.all([loadTerms(), refreshSummary()]);
      notify(
        'success',
        `导入完成：新增 ${report.added} 条，更新 ${report.updated} 条，跳过 ${report.skipped} 条，当前共 ${report.termsTotal} 条`,
      );
      if (report.conflicts.length > 0) {
        notify(
          'warning',
          `检测到 ${report.conflicts.length} 条译名冲突，已保留人工校对结果：\n${report.conflicts
            .slice(0, 5)
            .join('\n')}`,
        );
      }
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
    void startJob('glossary', false);
  };

  return (
    <>
      <PageHeader
        icon={<MenuBookOutlinedIcon />}
        title="术语表收集"
        description="按原始文本分组并发抽取人名、地名、道具名等专有名词；术语会注入后续翻译以保证译名统一。"
      />

      <Stack spacing={2.5}>
        <SectionCard
          title="术语收集任务"
          subtitle="人工修改的术语不会被 AI 结果覆盖；进度会在中断或重启后保留"
          action={
            <TaskControls
              snapshot={glossarySnapshot}
              startLabel="开始收集"
              busy={busyAction !== null}
              onStart={handleStart}
              onStop={() => void stopJob('glossary')}
            />
          }
        >
          <TaskProgress snapshot={glossarySnapshot} />
          {glossarySnapshot && glossarySnapshot.failed > 0 && glossarySnapshot.phase !== 'running' && (
            <Alert
              severity="warning"
              variant="outlined"
              sx={{ mt: 2 }}
              action={
                <Button size="small" onClick={() => void startJob('glossary', false)}>
                  继续执行
                </Button>
              }
            >
              有 {glossarySnapshot.failed} 个分组收集失败，继续执行只会重新处理未完成的分组。
            </Alert>
          )}
          <Box sx={{ mt: 2 }}>
            <LogPanel
              logs={glossarySnapshot?.logs ?? []}
              onClear={() => void clearLogs('glossary')}
            />
          </Box>
        </SectionCard>

        <SectionCard
          title="术语表"
          subtitle="修改后自动保存到当前项目工作区"
          action={
            <Chip
              variant="outlined"
              label={`共 ${formatNumber(pageData?.total ?? summary.glossaryCount)} 条 · 已译 ${formatNumber(
                pageData?.translated ?? summary.translatedGlossaryCount,
              )}`}
            />
          }
        >
          <GlossaryTable
            page={pageData}
            query={query}
            loading={loading}
            busy={fileBusy || saving || deleting}
            onQueryChange={updateQuery}
            onAdd={() => {
              setEditingTerm(null);
              setDialogOpen(true);
            }}
            onEdit={(term) => {
              setEditingTerm(term);
              setDialogOpen(true);
            }}
            onDelete={(term) => setDeleteTarget(term)}
            onImport={() => setImportOpen(true)}
            onExport={() => void handleExport()}
          />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            提示：手工新增或导入的术语标记为“人工”，编辑后立即生效；AI 只会补全缺失的译名。
          </Typography>
        </SectionCard>
      </Stack>

      <TermDialog
        open={dialogOpen}
        term={editingTerm}
        saving={saving}
        onClose={() => {
          setDialogOpen(false);
          setEditingTerm(null);
        }}
        onSave={(term) => void handleSaveTerm(term)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除术语"
        description={
          <>
            将删除术语「{deleteTarget?.source}」
            {deleteTarget?.target ? `（${deleteTarget.target}）` : ''}。此操作无法撤销，但不会影响已经生成的译文。
          </>
        }
        confirmLabel="删除"
        danger
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />

      <ConfirmDialog
        open={restartOpen}
        title="从头执行术语收集"
        description="将清空分组完成记录并重新处理所有分组。现有术语会保留，人工校对过的译名不会被覆盖。"
        confirmLabel="从头执行"
        danger
        loading={busyAction === 'start-glossary'}
        onCancel={() => setRestartOpen(false)}
        onConfirm={() => {
          setRestartOpen(false);
          void startJob('glossary', true);
        }}
      />

      <ImportGlossaryDialog
        open={importOpen}
        totalTerms={summary.glossaryCount}
        busy={fileBusy}
        onClose={() => setImportOpen(false)}
        onConfirm={(mode) => void handleImport(mode)}
      />
    </>
  );
}
