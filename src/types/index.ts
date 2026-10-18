/** 与 Rust 后端保持一致的数据类型定义。 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';
export type BackoffStrategy = 'none' | 'linear' | 'exponential';
export type GlossaryInjection = 'off' | 'matched' | 'matchedWithNote';
export type LongTextStrategy = 'skip' | 'isolate';

export type ItemStatus = 'pending' | 'done' | 'failed';
export type JobKind = 'glossary' | 'translate';
export type JobPhase = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'interrupted';
export type Severity = 'success' | 'info' | 'warning' | 'error';
export type Route = 'welcome' | 'config' | 'glossary' | 'translate' | 'settings';

export interface AppearanceSettings {
  themeMode: ThemeMode;
  primaryColor: string;
  density: Density;
  fontFamily: string;
  fontSize: number;
}

export interface ApiSettingsView {
  baseUrl: string;
  model: string;
  temperature: number;
  timeoutSecs: number;
  jsonMode: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
}

export interface ApiSettingsInput {
  baseUrl: string;
  model: string;
  temperature: number;
  timeoutSecs: number;
  jsonMode: boolean;
  /** 留空表示保留已保存的密钥。 */
  apiKey?: string;
  clearApiKey: boolean;
}

export interface TranslationSettings {
  concurrency: number;
  maxCharsPerBatch: number;
  maxItemsPerBatch: number;
  retryTimes: number;
  backoffStrategy: BackoffStrategy;
  backoffMs: number;
  glossaryInjection: GlossaryInjection;
  systemPrompt: string;
  userPrompt: string;
  longTextStrategy: LongTextStrategy;
  continueOnBatchError: boolean;
  glossaryBatchChars: number;
  glossaryBatchItems: number;
}

export interface SettingsView {
  appearance: AppearanceSettings;
  api: ApiSettingsView;
  translation: TranslationSettings;
}

export interface SettingsInput {
  appearance: AppearanceSettings;
  api: ApiSettingsInput;
  translation: TranslationSettings;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  workspaceRoot: string;
}

export interface ProjectSource {
  path: string;
  /** 浏览器预览时由前端读取的文件内容。 */
  text?: string;
}

export interface GroupOption {
  index: number;
  id: string;
  count: number;
}

export interface JobMeta {
  phase: string;
  total: number;
  done: number;
  failed: number;
  message: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt?: string | null;
}

export interface ProjectSummary {
  sourcePath: string;
  fileName: string;
  sourceLang: string;
  targetLang: string;
  groupCount: number;
  itemCount: number;
  charCount: number;
  doneCount: number;
  failedCount: number;
  pendingCount: number;
  glossaryCount: number;
  translatedGlossaryCount: number;
  workspacePath: string;
  updatedAt: string;
  groups: GroupOption[];
  warnings: string[];
  translateJob: JobMeta;
  glossaryJob: JobMeta;
}

export interface RecentProject {
  sourcePath: string;
  fileName: string;
  itemCount: number;
  doneCount: number;
  glossaryCount: number;
  sourceLang: string;
  targetLang: string;
  updatedAt: string;
  exists: boolean;
}

export interface ItemQuery {
  page: number;
  pageSize: number;
  status: 'all' | ItemStatus;
  groupIndex: number | null;
  keyword: string;
}

export interface ItemView {
  key: string;
  group: string;
  groupIndex: number;
  indexInGroup: number;
  original: string;
  translation: string;
  status: ItemStatus;
  error: string | null;
  segmentCount: number;
  skipped: boolean;
  hasReference: boolean;
  manual: boolean;
}

export interface ItemPage {
  total: number;
  page: number;
  pageSize: number;
  items: ItemView[];
  done: number;
  failed: number;
  pending: number;
}

export interface GlossaryTerm {
  source: string;
  target: string;
  note: string;
  manual: boolean;
}

export interface TermQuery {
  page: number;
  pageSize: number;
  keyword: string;
  filter: 'all' | 'translated' | 'untranslated' | 'manual';
}

export interface TermPage {
  total: number;
  page: number;
  pageSize: number;
  items: GlossaryTerm[];
  translated: number;
}

export interface GlossaryImportReport {
  total: number;
  added: number;
  updated: number;
  skipped: number;
  replaced: boolean;
  conflicts: string[];
  termsTotal: number;
}

export interface ImportReport {
  totalGroups: number;
  matchedGroups: number;
  unknownGroups: number;
  applied: number;
  skipped: number;
  mismatched: number;
}

export interface ExportResult {
  path: string;
  itemCount: number;
  bytes: number;
}

export interface TermSaveResult {
  term: GlossaryTerm;
  summary: ProjectSummary;
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  endpoint: string;
  model: string;
  message: string;
}

export interface LogEntry {
  time: string;
  level: string;
  message: string;
}

export interface JobSnapshot {
  kind: JobKind;
  phase: JobPhase;
  total: number;
  done: number;
  failed: number;
  pending: number;
  running: number;
  batchTotal: number;
  batchDone: number;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedSecs: number;
  logs: LogEntry[];
}

export interface JobSnapshots {
  glossary: JobSnapshot;
  translate: JobSnapshot;
}

export const LANGUAGE_OPTIONS = [
  { value: 'ja', label: '日语' },
  { value: 'en', label: '英语' },
  { value: 'ko', label: '韩语' },
  { value: 'ru', label: '俄语' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁体中文' },
] as const;

export const FONT_OPTIONS = [
  { value: 'system', label: '系统默认' },
  { value: 'yahei', label: '微软雅黑' },
  { value: 'noto', label: '思源黑体 / Noto Sans SC' },
  { value: 'mono', label: '等宽字体（日志与代码优先）' },
] as const;

export const PRIMARY_COLORS = [
  '#3B82F6',
  '#6366F1',
  '#8B5CF6',
  '#EC4899',
  '#EF4444',
  '#F59E0B',
  '#10B981',
  '#14B8A6',
] as const;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeMode: 'system',
  primaryColor: '#3B82F6',
  density: 'comfortable',
  fontFamily: 'system',
  fontSize: 14,
};

export const DEFAULT_API_INPUT = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  timeoutSecs: 120,
  jsonMode: true,
};

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  concurrency: 3,
  maxCharsPerBatch: 1200,
  maxItemsPerBatch: 20,
  retryTimes: 2,
  backoffStrategy: 'exponential',
  backoffMs: 1500,
  glossaryInjection: 'matched',
  systemPrompt: '',
  userPrompt: '',
  longTextStrategy: 'skip',
  continueOnBatchError: true,
  glossaryBatchChars: 2000,
  glossaryBatchItems: 40,
};

export const STATUS_LABELS: Record<ItemStatus, string> = {
  pending: '待处理',
  done: '已完成',
  failed: '失败',
};

export const PHASE_LABELS: Record<JobPhase, string> = {
  idle: '未开始',
  running: '执行中',
  paused: '已中断',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
};
