import type {
  AppInfo,
  ExportResult,
  GlossaryImportReport,
  GlossaryTerm,
  ImportReport,
  ItemPage,
  ItemQuery,
  JobKind,
  JobSnapshots,
  ProjectEntry,
  ProjectSource,
  ProjectSummary,
  SettingsInput,
  SourceStatus,
  SettingsView,
  ApiSettingsInput,
  TermPage,
  TermQuery,
  TermSaveResult,
  TestConnectionResult,
} from '@/types';

/** 前端可调用的后端能力，Tauri 与浏览器 Mock 使用同一份契约。 */
export interface Backend {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<SettingsView>;
  saveSettings(input: SettingsInput): Promise<SettingsView>;
  testConnection(input: ApiSettingsInput): Promise<TestConnectionResult>;

  listProjects(): Promise<ProjectEntry[]>;
  /** 检测源文件是否存在、内容是否与项目记录不一致。 */
  projectSourceStatus(sourcePath: string): Promise<SourceStatus>;

  openProject(source: ProjectSource, reloadSource?: boolean): Promise<ProjectSummary>;
  getProjectSummary(): Promise<ProjectSummary>;
  setLanguages(sourceLang: string, targetLang: string): Promise<ProjectSummary>;

  listItems(query: ItemQuery): Promise<ItemPage>;
  setItemTranslation(
    groupIndex: number,
    indexInGroup: number,
    translation: string,
  ): Promise<ProjectSummary>;
  exportTranslation(destPath: string): Promise<ExportResult>;
  importTranslations(path: string, text?: string): Promise<ImportReport>;

  listTerms(query: TermQuery): Promise<TermPage>;
  saveTerm(term: GlossaryTerm): Promise<TermSaveResult>;
  deleteTerms(sources: string[]): Promise<ProjectSummary>;
  importGlossary(
    path: string,
    mode: 'merge' | 'replace',
    text?: string,
  ): Promise<GlossaryImportReport>;
  exportGlossary(destPath: string): Promise<string>;

  startGlossaryJob(restart: boolean): Promise<void>;
  startTranslateJob(restart: boolean): Promise<void>;
  stopJob(kind: JobKind): Promise<void>;
  jobSnapshots(): Promise<JobSnapshots>;
  clearJobLogs(kind: JobKind): Promise<void>;
}
