import { invoke } from '@tauri-apps/api/core';

import type {
  AppInfo,
  ApiSettingsInput,
  ExportResult,
  GlossaryImportReport,
  GlossaryTerm,
  ImportReport,
  ItemPage,
  ItemQuery,
  JobKind,
  JobSnapshots,
  ProjectSource,
  ProjectSummary,
  RecentProject,
  SettingsInput,
  SettingsView,
  TermPage,
  TermQuery,
  TermSaveResult,
  TestConnectionResult,
} from '@/types';

import type { Backend } from './contract';

/** Tauri Commands 封装：与 Rust 后端一一对应。 */
export const tauriBackend: Backend = {
  getAppInfo: () => invoke<AppInfo>('get_app_info'),
  getSettings: () => invoke<SettingsView>('get_settings'),
  saveSettings: (input: SettingsInput) => invoke<SettingsView>('save_settings', { input }),
  testConnection: (input: ApiSettingsInput) =>
    invoke<TestConnectionResult>('test_connection', { input }),

  getRecentProjects: () => invoke<RecentProject[]>('get_recent_projects'),
  removeRecentProject: (sourcePath: string) =>
    invoke<void>('remove_recent_project', { sourcePath }),

  openProject: (source: ProjectSource) =>
    invoke<ProjectSummary>('open_project', { sourcePath: source.path }),
  getProjectSummary: () => invoke<ProjectSummary>('get_project_summary'),
  setLanguages: (sourceLang: string, targetLang: string) =>
    invoke<ProjectSummary>('set_languages', { sourceLang, targetLang }),

  listItems: (query: ItemQuery) => invoke<ItemPage>('list_items', { query }),
  setItemTranslation: (groupIndex: number, indexInGroup: number, translation: string) =>
    invoke<ProjectSummary>('set_item_translation', { groupIndex, indexInGroup, translation }),
  exportTranslation: (destPath: string) =>
    invoke<ExportResult>('export_translation', { destPath }),
  importTranslations: (path: string) => invoke<ImportReport>('import_translations', { path }),

  listTerms: (query: TermQuery) => invoke<TermPage>('list_terms', { query }),
  saveTerm: (term: GlossaryTerm) => invoke<TermSaveResult>('save_term', { term }),
  deleteTerms: (sources: string[]) => invoke<ProjectSummary>('delete_terms', { sources }),
  importGlossary: (path: string, mode: 'merge' | 'replace') =>
    invoke<GlossaryImportReport>('import_glossary', { path, mode }),
  exportGlossary: (destPath: string) => invoke<string>('export_glossary', { destPath }),

  startGlossaryJob: (restart: boolean) => invoke<void>('start_glossary_job', { restart }),
  startTranslateJob: (restart: boolean) => invoke<void>('start_translate_job', { restart }),
  stopJob: (kind: JobKind) => invoke<void>('stop_job', { kind }),
  jobSnapshots: () => invoke<JobSnapshots>('job_snapshots'),
  clearJobLogs: (kind: JobKind) => invoke<void>('clear_job_logs', { kind }),
};
