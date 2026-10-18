import { create } from 'zustand';

import { api } from '@/api';
import type { JobKind, JobSnapshots } from '@/types';
import { errorMessage } from '@/utils/format';

import { useAppStore } from './useAppStore';

interface JobsStore {
  snapshots: JobSnapshots | null;
  busyAction: string | null;
  fetch: () => Promise<void>;
  startJob: (kind: JobKind, restart: boolean) => Promise<void>;
  stopJob: (kind: JobKind) => Promise<void>;
  clearLogs: (kind: JobKind) => Promise<void>;
}

export const useJobsStore = create<JobsStore>((set, get) => ({
  snapshots: null,
  busyAction: null,

  fetch: async () => {
    try {
      const next = await api.jobSnapshots();
      const previous = get().snapshots;
      set({ snapshots: next });
      const stopped = (kind: JobKind): boolean =>
        previous?.[kind].phase === 'running' && next[kind].phase !== 'running';
      if (stopped('translate') || stopped('glossary')) {
        void useAppStore.getState().refreshSummary();
      }
    } catch {
      // 轮询失败时保持上一次快照，避免界面闪烁
    }
  },

  startJob: async (kind, restart) => {
    if (get().busyAction) {
      return;
    }
    set({ busyAction: `start-${kind}` });
    try {
      if (kind === 'translate') {
        await api.startTranslateJob(restart);
      } else {
        await api.startGlossaryJob(restart);
      }
      await get().fetch();
      useAppStore
        .getState()
        .notify('info', kind === 'translate' ? '翻译任务已启动' : '术语收集任务已启动');
    } catch (error) {
      useAppStore.getState().notify('error', errorMessage(error));
    } finally {
      set({ busyAction: null });
      void useAppStore.getState().refreshSummary();
    }
  },

  stopJob: async (kind) => {
    set({ busyAction: `stop-${kind}` });
    try {
      await api.stopJob(kind);
      await get().fetch();
      useAppStore.getState().notify('warning', '已请求中断，正在等待在途请求结束');
    } catch (error) {
      useAppStore.getState().notify('error', errorMessage(error));
    } finally {
      set({ busyAction: null });
    }
  },

  clearLogs: async (kind) => {
    try {
      await api.clearJobLogs(kind);
      await get().fetch();
    } catch (error) {
      useAppStore.getState().notify('error', errorMessage(error));
    }
  },
}));

/** 应用启动后按固定间隔拉取任务快照，任务执行不依赖组件挂载。 */
export function startJobsPolling(intervalMs = 900): () => void {
  const tick = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    void useJobsStore.getState().fetch();
  };
  tick();
  const timer = window.setInterval(tick, intervalMs);
  return () => window.clearInterval(timer);
}
