import { create } from 'zustand';

import { api, isDesktop } from '@/api';
import type {
  AppInfo,
  ProjectSource,
  ProjectSummary,
  RecentProject,
  Route,
  SettingsInput,
  SettingsView,
  Severity,
} from '@/types';
import { errorMessage } from '@/utils/format';

interface SnackbarState {
  id: number;
  message: string;
  severity: Severity;
}

interface AppStore {
  ready: boolean;
  fatalError: string | null;
  route: Route;
  settings: SettingsView | null;
  summary: ProjectSummary | null;
  recent: RecentProject[];
  appInfo: AppInfo | null;
  opening: boolean;
  busy: string | null;
  snackbar: SnackbarState | null;

  bootstrap: () => Promise<void>;
  navigate: (route: Route) => void;
  notify: (severity: Severity, message: string) => void;
  dismissSnackbar: () => void;
  openProject: (source: ProjectSource) => Promise<boolean>;
  loadRecent: () => Promise<void>;
  removeRecent: (sourcePath: string) => Promise<void>;
  refreshSummary: () => Promise<void>;
  applySummary: (summary: ProjectSummary) => void;
  setLanguages: (sourceLang: string, targetLang: string) => Promise<void>;
  saveSettings: (input: SettingsInput) => Promise<boolean>;
  previewAppearance: (appearance: SettingsView['appearance']) => void;
  setBusy: (key: string | null) => void;
}

let snackbarSeq = 0;
let bootstrapping = false;

export const useAppStore = create<AppStore>((set, get) => ({
  ready: false,
  fatalError: null,
  route: 'welcome',
  settings: null,
  summary: null,
  recent: [],
  appInfo: null,
  opening: false,
  busy: null,
  snackbar: null,

  bootstrap: async () => {
    if (bootstrapping || get().ready) {
      return;
    }
    bootstrapping = true;
    try {
      const [appInfo, settings, recent] = await Promise.all([
        api.getAppInfo(),
        api.getSettings(),
        api.getRecentProjects(),
      ]);
      let summary: ProjectSummary | null = null;
      try {
        summary = await api.getProjectSummary();
      } catch {
        summary = null;
      }
      // 桌面端自动恢复上次打开的项目与任务进度；浏览器预览保持欢迎页便于调试
      if (!summary && isDesktop) {
        const last = recent.find((entry) => entry.exists);
        if (last) {
          try {
            summary = await api.openProject({ path: last.sourcePath });
          } catch {
            summary = null;
          }
        }
      }
      set({
        appInfo,
        settings,
        recent,
        summary,
        ready: true,
        route: summary ? 'config' : 'welcome',
      });
    } catch (error) {
      set({ ready: true, fatalError: errorMessage(error) });
    }
  },

  navigate: (route) => set({ route }),

  notify: (severity, message) =>
    set({ snackbar: { id: (snackbarSeq += 1), message, severity } }),

  dismissSnackbar: () => set({ snackbar: null }),

  openProject: async (source) => {
    set({ opening: true });
    try {
      const summary = await api.openProject(source);
      const recent = await api.getRecentProjects();
      set({ summary, recent, route: 'config' });
      if (summary.warnings.length > 0) {
        get().notify('warning', summary.warnings.join('；'));
      } else {
        get().notify('success', `已加载 ${summary.fileName}`);
      }
      return true;
    } catch (error) {
      get().notify('error', errorMessage(error));
      return false;
    } finally {
      set({ opening: false });
    }
  },

  loadRecent: async () => {
    try {
      const recent = await api.getRecentProjects();
      set({ recent });
    } catch (error) {
      get().notify('error', errorMessage(error));
    }
  },

  removeRecent: async (sourcePath) => {
    try {
      await api.removeRecentProject(sourcePath);
      await get().loadRecent();
      get().notify('info', '已从最近项目中移除');
    } catch (error) {
      get().notify('error', errorMessage(error));
    }
  },

  refreshSummary: async () => {
    try {
      const summary = await api.getProjectSummary();
      set({ summary });
    } catch {
      // 没有打开项目时忽略
    }
  },

  applySummary: (summary) => set({ summary }),

  setLanguages: async (sourceLang, targetLang) => {
    try {
      const summary = await api.setLanguages(sourceLang, targetLang);
      set({ summary });
    } catch (error) {
      get().notify('error', errorMessage(error));
    }
  },

  saveSettings: async (input) => {
    try {
      const settings = await api.saveSettings(input);
      set({ settings });
      return true;
    } catch (error) {
      get().notify('error', errorMessage(error));
      return false;
    }
  },

  previewAppearance: (appearance) =>
    set((state) => (state.settings ? { settings: { ...state.settings, appearance } } : state)),

  setBusy: (key) => set({ busy: key }),
}));
