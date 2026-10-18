/**
 * 浏览器预览使用的内存版后端。
 * 实现与 Tauri 后端一致的行为：项目解析、分页查询、术语合并、任务进度模拟与文件下载。
 */

import type {
  ApiSettingsInput,
  AppInfo,
  ExportResult,
  GlossaryImportReport,
  GlossaryTerm,
  ImportReport,
  ItemPage,
  ItemQuery,
  ItemStatus,
  ItemView,
  JobKind,
  JobMeta,
  JobPhase,
  JobSnapshot,
  JobSnapshots,
  LogEntry,
  ProjectSource,
  ProjectSummary,
  RecentProject,
  SettingsInput,
  SettingsView,
  TermPage,
  TermQuery,
  TermSaveResult,
} from '@/types';
import { DEFAULT_APPEARANCE } from '@/types';

import type { Backend } from './contract';

const SETTINGS_KEY = 'fgpt.mock.settings.v1';
const RECENT_KEY = 'fgpt.mock.recent.v1';
const DEMO_PATH = 'demo://FunnyGameTranslations.json';

// ---------------------------------------------------------------- 通用工具

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const nowIso = (): string => new Date().toISOString();
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));
const normalize = (value: string): string => value.trim().toLowerCase();
const charCount = (value: string): number => [...value].length;

function download(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const baseName = (path: string, fallback: string): string => {
  const normalized = path.replace(/\\/g, '/');
  const name = normalized.split('/').filter(Boolean).pop();
  return name && name.includes('.') ? name : fallback;
};

// ---------------------------------------------------------------- 演示数据

const DEMO_TERMS: GlossaryTerm[] = [
  { source: '佐伯', target: '佐伯', note: '角色', manual: true },
  { source: '根岸', target: '根岸', note: '角色', manual: true },
  { source: '回復薬', target: '回复药', note: '道具', manual: false },
  { source: '魔力の欠片', target: '魔力碎片', note: '道具', manual: false },
  { source: '疾風斬', target: '疾风斩', note: '技能', manual: false },
  { source: 'スライム', target: '史莱姆', note: '敌人', manual: false },
];

const DEMO_GROUPS: { id: string; entries: [string, string][] }[] = [
  {
    id: 'dataActors',
    entries: [
      ['佐伯', '佐伯'],
      ['根岸', '根岸'],
      ['佐伯眼鏡なし', '没戴眼镜的佐伯'],
      ['選抜', '选拔'],
      ['地田', '地田'],
      ['赤羽弓道部', '赤羽弓道部'],
      ['遠藤', '远藤'],
      ['宮本', '宫本'],
      ['篠原', '篠原'],
      ['大谷', '大谷'],
      ['佐久間', '佐久间'],
      ['チュッチョ泊', '丘乔住宿'],
    ],
  },
  {
    id: 'dataItems',
    entries: [
      ['回復薬', '回复药'],
      ['魔力の欠片', '魔力碎片'],
      ['古びた鍵', '古旧钥匙'],
      ['布の服', '布衣'],
      ['鉄の剣', '铁剑'],
      ['薬草', '药草'],
      ['魔導書', '魔导书'],
      ['銀の腕輪', '银手镯'],
      ['灯油', '灯油'],
      ['石ころ', '小石子'],
    ],
  },
  {
    id: 'dataSkills',
    entries: [
      ['火球', '火球术'],
      ['氷結', '冰结'],
      ['回復の光', '治愈之光'],
      ['疾風斬', '疾风斩'],
      ['守護の壁', '守护之壁'],
      ['雷撃', '雷击'],
      ['毒霧', '毒雾'],
      ['聖なる加護', '圣光庇护'],
    ],
  },
  {
    id: 'dataEnemies',
    entries: [
      ['スライム', '史莱姆'],
      ['ゴブリン', '哥布林'],
      ['オオカミ', '野狼'],
      ['オーク', '兽人'],
      ['リザードマン', '蜥蜴人'],
      ['ダークナイト', '暗黑骑士'],
    ],
  },
  {
    id: 'dataCommon',
    entries: [
      ['セーブしました', '已保存'],
      ['ロードしますか？', '要读取吗？'],
      ['ゲームを終了します', '退出游戏'],
      ['所持金が足りません', '所持金币不足'],
      ['戦闘に勝利した！', '战斗胜利！'],
      ['レベルが上がった！', '等级提升！'],
      ['装備を変更しました', '已更换装备'],
      ['ここでは使えません', '此处无法使用'],
    ],
  },
  {
    id: 'dataDialogues',
    entries: [
      ['「おはよう。今日もいい天気だね」\n「そうだね、散歩でも行こうか」', '「早上好，今天天气也不错呢。」\n「是啊，要不去散散步吧。」'],
      ['「この先は危険だ。準備はいいか？」\n「ああ、いつでも行ける」', '「前面很危险，准备好了吗？」\n「嗯，随时可以出发。」'],
    ],
  },
];

/** 生成一段超长 JSON 文本，用于演示超长文本策略。 */
function longEventText(): string {
  const lines: string[] = [];
  for (let index = 0; index < 220; index += 1) {
    lines.push(`"line_${index}": "これは非常に長いイベントテキストの ${index} 行目です。"`);
  }
  return `{\n${lines.join(',\n')}\n}`;
}

const TRANSLATION_MAP = new Map<string, string>();
for (const group of DEMO_GROUPS) {
  for (const [source, target] of group.entries) {
    TRANSLATION_MAP.set(source, target);
  }
}

const fallbackTranslate = (text: string): string => {
  const hit = TRANSLATION_MAP.get(text);
  if (hit) {
    return hit;
  }
  return `【示例译文】${text}`;
};

// ---------------------------------------------------------------- 项目模型

interface MockItem {
  original: string;
  sourceSegments: string[];
  targetSegments: string[];
  status: ItemStatus;
  error: string | null;
  reference: string[] | null;
  skipped: boolean;
  manual: boolean;
}

interface MockGroup {
  id: string;
  items: MockItem[];
}

interface MockProject {
  sourcePath: string;
  fileName: string;
  sourceLang: string;
  targetLang: string;
  groups: MockGroup[];
  updatedAt: string;
}

interface ParsedTranslation {
  original: string;
  originalSequence: string[];
  translationSequence: string[];
}

interface ParsedGroup {
  id: string;
  translations: ParsedTranslation[];
}

function parseSource(text: string): ParsedGroup[] {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`文件不是合法的 JSON：${(error as Error).message}`);
  }

  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.groups)
      ? value.groups
      : null;
  if (!list) {
    throw new Error('JSON 结构不符：应为包含 id 与 translations 的对象数组');
  }
  if (list.length === 0) {
    throw new Error('文件中没有任何翻译分组');
  }

  const groups: ParsedGroup[] = [];
  let itemCount = 0;
  list.forEach((rawGroup, groupIndex) => {
    if (!isRecord(rawGroup)) {
      throw new Error(`第 ${groupIndex + 1} 个分组不是对象`);
    }
    const translationsRaw = rawGroup.translations ?? rawGroup.items;
    if (!Array.isArray(translationsRaw)) {
      throw new Error(`第 ${groupIndex + 1} 个分组缺少 translations 数组`);
    }
    const translations: ParsedTranslation[] = [];
    translationsRaw.forEach((rawItem, itemIndex) => {
      if (!isRecord(rawItem)) {
        throw new Error(`分组 ${groupIndex + 1} 的第 ${itemIndex + 1} 条文本不是对象`);
      }
      const original = asString(rawItem.original);
      const originalSequence = asStringArray(rawItem.original_sequence);
      const translationSequence = asStringArray(rawItem.translation_sequence);
      translations.push({
        original,
        originalSequence: originalSequence.length > 0 ? originalSequence : original ? [original] : [],
        translationSequence,
      });
    });
    itemCount += translations.length;
    groups.push({
      id: asString(rawGroup.id) || `group${groupIndex}`,
      translations,
    });
  });

  if (itemCount === 0) {
    throw new Error('文件不包含任何文本条目');
  }
  return groups;
}

function buildProject(sourcePath: string, parsed: ParsedGroup[]): MockProject {
  const groups: MockGroup[] = parsed.map((group) => ({
    id: group.id,
    items: group.translations.map((translation) => {
      const sourceSegments =
        translation.originalSequence.length > 0
          ? translation.originalSequence
          : translation.original
            ? [translation.original]
            : [];
      const targetSegments =
        translation.translationSequence.length === sourceSegments.length &&
        translation.translationSequence.length > 0
          ? translation.translationSequence
          : [...sourceSegments];
      const hasSource = sourceSegments.some((segment) => segment.trim().length > 0);
      const translated = targetSegments.some((segment) => segment.trim().length > 0) &&
        targetSegments.join('\n') !== sourceSegments.join('\n');
      return {
        original: translation.original || sourceSegments.join('\n'),
        sourceSegments,
        targetSegments,
        status: !hasSource || translated ? 'done' : 'pending',
        error: null,
        reference: null,
        skipped: false,
        manual: false,
      };
    }),
  }));

  return {
    sourcePath,
    fileName: baseName(sourcePath, 'FunnyGameTranslations.json'),
    sourceLang: 'ja',
    targetLang: 'zh-CN',
    groups,
    updatedAt: nowIso(),
  };
}

function createDemoProject(sourcePath = DEMO_PATH): MockProject {
  const parsed: ParsedGroup[] = DEMO_GROUPS.map((group) => ({
    id: group.id,
    translations: group.entries.map(([source]) => ({
      original: source,
      originalSequence: source.split('\n'),
      translationSequence: source.split('\n'),
    })),
  }));
  // 超长文本（超过默认单批上限 1200 字的 6 倍），用于演示跳过策略
  parsed.push({
    id: 'dataEvents',
    translations: [
      {
        original: longEventText(),
        originalSequence: [longEventText()],
        translationSequence: [longEventText()],
      },
    ],
  });
  const project = buildProject(sourcePath, parsed);
  // 演示项目中预先完成部分条目，接近真实使用场景
  const actors = project.groups[0];
  if (actors) {
    actors.items.slice(0, 4).forEach((item, index) => {
      const target = DEMO_GROUPS[0].entries[index]?.[1];
      if (target) {
        item.targetSegments = [target];
        item.status = 'done';
      }
    });
  }
  return project;
}

// ---------------------------------------------------------------- 持久化设置

const defaultSettingsView = (): SettingsView => ({
  appearance: { ...DEFAULT_APPEARANCE },
  api: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    temperature: 0.3,
    timeoutSecs: 120,
    jsonMode: true,
    hasApiKey: false,
    apiKeyMasked: '',
  },
  translation: {
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
  },
});

interface StoredSettings {
  appearance: SettingsView['appearance'];
  api: Omit<SettingsView['api'], 'hasApiKey' | 'apiKeyMasked'>;
  translation: SettingsView['translation'];
  apiKey: string;
}

function loadSettings(): StoredSettings {
  const fallback = defaultSettingsView();
  const fallbackStored: StoredSettings = {
    appearance: fallback.appearance,
    api: {
      baseUrl: fallback.api.baseUrl,
      model: fallback.api.model,
      temperature: fallback.api.temperature,
      timeoutSecs: fallback.api.timeoutSecs,
      jsonMode: fallback.api.jsonMode,
    },
    translation: fallback.translation,
    apiKey: '',
  };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return fallbackStored;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return fallbackStored;
    }
    return {
      appearance: { ...fallbackStored.appearance, ...(isRecord(parsed.appearance) ? parsed.appearance : {}) },
      api: { ...fallbackStored.api, ...(isRecord(parsed.api) ? parsed.api : {}) },
      translation: { ...fallbackStored.translation, ...(isRecord(parsed.translation) ? parsed.translation : {}) },
      apiKey: asString(parsed.apiKey),
    };
  } catch {
    return fallbackStored;
  }
}

function persistSettings(): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(storedSettings));
  } catch {
    // 忽略隐私模式下的存储失败
  }
}

const maskKey = (key: string): string => {
  if (!key) {
    return '';
  }
  if (key.length <= 8) {
    return '••••••••';
  }
  return `••••••••${key.slice(-4)}`;
};

function settingsView(): SettingsView {
  return {
    appearance: { ...storedSettings.appearance },
    api: {
      ...storedSettings.api,
      hasApiKey: storedSettings.apiKey.length > 0,
      apiKeyMasked: maskKey(storedSettings.apiKey),
    },
    translation: { ...storedSettings.translation },
  };
}

let storedSettings = loadSettings();

// ---------------------------------------------------------------- 最近项目

function loadRecent(): RecentProject[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isRecord).map((entry) => ({
      sourcePath: asString(entry.sourcePath),
      fileName: asString(entry.fileName),
      itemCount: Number(entry.itemCount) || 0,
      doneCount: Number(entry.doneCount) || 0,
      glossaryCount: Number(entry.glossaryCount) || 0,
      sourceLang: asString(entry.sourceLang) || 'ja',
      targetLang: asString(entry.targetLang) || 'zh-CN',
      updatedAt: asString(entry.updatedAt) || nowIso(),
      exists: asString(entry.sourcePath).startsWith('demo://'),
    }));
  } catch {
    return [];
  }
}

let recentProjects = loadRecent();

function persistRecent(): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recentProjects));
  } catch {
    // 忽略
  }
}

// ---------------------------------------------------------------- 会话状态

let project: MockProject | null = null;
let terms: GlossaryTerm[] = [];
const glossaryByPath = new Map<string, GlossaryTerm[]>();

const jobStates: Record<JobKind, MockJob> = {
  glossary: createJob(),
  translate: createJob(),
};

interface MockJob {
  phase: JobPhase;
  total: number;
  done: number;
  failed: number;
  running: number;
  batchTotal: number;
  batchDone: number;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  startedAtMs: number | null;
  elapsedSecs: number;
  logs: LogEntry[];
  timer: number | null;
  queue: { group: number; item: number }[];
  groupQueue: number[];
}

function createJob(): MockJob {
  return {
    phase: 'idle',
    total: 0,
    done: 0,
    failed: 0,
    running: 0,
    batchTotal: 0,
    batchDone: 0,
    message: '',
    startedAt: null,
    finishedAt: null,
    startedAtMs: null,
    elapsedSecs: 0,
    logs: [],
    timer: null,
    queue: [],
    groupQueue: [],
  };
}

function resetJob(job: MockJob): void {
  if (job.timer !== null) {
    window.clearInterval(job.timer);
  }
  const fresh = createJob();
  Object.assign(job, fresh);
}

function log(job: MockJob, level: string, message: string): void {
  job.logs.push({ time: nowIso(), level, message });
  if (job.logs.length > 400) {
    job.logs.splice(0, job.logs.length - 400);
  }
}

function finishJob(job: MockJob, phase: JobPhase, message: string): void {
  if (job.timer !== null) {
    window.clearInterval(job.timer);
    job.timer = null;
  }
  job.elapsedSecs = job.startedAtMs ? Math.round((Date.now() - job.startedAtMs) / 1000) : 0;
  job.phase = phase;
  job.message = message;
  job.finishedAt = nowIso();
  job.running = 0;
  log(job, 'info', message);
}

function jobSnapshot(kind: JobKind): JobSnapshot {
  const job = jobStates[kind];
  const elapsed = job.startedAtMs && job.phase === 'running'
    ? Math.round((Date.now() - job.startedAtMs) / 1000)
    : job.elapsedSecs;
  return {
    kind,
    phase: job.phase,
    total: job.total,
    done: job.done,
    failed: job.failed,
    pending: Math.max(0, job.total - job.done - job.failed),
    running: job.running,
    batchTotal: job.batchTotal,
    batchDone: job.batchDone,
    message: job.message,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    elapsedSecs: elapsed,
    logs: job.logs.map((entry) => ({ ...entry })),
  };
}

function jobMeta(kind: JobKind): JobMeta {
  const snapshot = jobSnapshot(kind);
  return {
    phase: snapshot.phase,
    total: snapshot.total,
    done: snapshot.done,
    failed: snapshot.failed,
    message: snapshot.message,
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
    updatedAt: nowIso(),
  };
}

function projectCounts(): {
  groupCount: number;
  itemCount: number;
  charCount: number;
  doneCount: number;
  failedCount: number;
  pendingCount: number;
} {
  const counts = {
    groupCount: project?.groups.length ?? 0,
    itemCount: 0,
    charCount: 0,
    doneCount: 0,
    failedCount: 0,
    pendingCount: 0,
  };
  if (!project) {
    return counts;
  }
  for (const group of project.groups) {
    for (const item of group.items) {
      counts.itemCount += 1;
      counts.charCount += charCount(item.original || item.sourceSegments.join('\n'));
      if (item.status === 'done') {
        counts.doneCount += 1;
      } else if (item.status === 'failed') {
        counts.failedCount += 1;
      } else {
        counts.pendingCount += 1;
      }
    }
  }
  return counts;
}

function summary(): ProjectSummary {
  if (!project) {
    throw new Error('尚未打开项目');
  }
  const counts = projectCounts();
  return {
    sourcePath: project.sourcePath,
    fileName: project.fileName,
    sourceLang: project.sourceLang,
    targetLang: project.targetLang,
    ...counts,
    glossaryCount: terms.length,
    translatedGlossaryCount: terms.filter((term) => term.target.trim().length > 0).length,
    workspacePath: `memory://workspaces/${project.fileName}`,
    updatedAt: project.updatedAt,
    groups: project.groups.map((group, index) => ({
      index,
      id: group.id,
      count: group.items.length,
    })),
    warnings: [],
    translateJob: jobMeta('translate'),
    glossaryJob: jobMeta('glossary'),
  };
}

function upsertRecent(value: ProjectSummary): void {
  recentProjects = recentProjects.filter((entry) => entry.sourcePath !== value.sourcePath);
  recentProjects.unshift({
    sourcePath: value.sourcePath,
    fileName: value.fileName,
    itemCount: value.itemCount,
    doneCount: value.doneCount,
    glossaryCount: value.glossaryCount,
    sourceLang: value.sourceLang,
    targetLang: value.targetLang,
    updatedAt: nowIso(),
    exists: value.sourcePath.startsWith('demo://'),
  });
  recentProjects = recentProjects.slice(0, 12);
  persistRecent();
}

// ---------------------------------------------------------------- 任务模拟

function queueTranslateItems(job: MockJob): number {
  job.queue = [];
  if (!project) {
    return 0;
  }
  const limit = storedSettings.translation.maxCharsPerBatch;
  const hardLimit = limit * 6;
  let skipped = 0;
  project.groups.forEach((group, groupIndex) => {
    group.items.forEach((item, itemIndex) => {
      if (item.status !== 'pending') {
        return;
      }
      const length = charCount(item.sourceSegments.join('\n'));
      if (length > hardLimit && storedSettings.translation.longTextStrategy === 'skip') {
        item.status = 'failed';
        item.error = `文本长度 ${length} 字符，超过单批上限的 6 倍（${hardLimit}），已跳过`;
        item.skipped = true;
        skipped += 1;
        return;
      }
      job.queue.push({ group: groupIndex, item: itemIndex });
    });
  });
  job.total = job.queue.length + skipped;
  job.batchTotal = Math.ceil(job.queue.length / 4);
  job.message = `准备翻译 ${job.queue.length} 条文本（${job.batchTotal} 个批次）`;
  return skipped;
}

function translateItemText(source: string): string {
  return fallbackTranslate(source);
}

function tickTranslate(): void {
  const job = jobStates.translate;
  if (!project || job.phase !== 'running') {
    return;
  }
  const batch = job.queue.splice(0, 4);
  if (batch.length === 0) {
    const failed = job.failed;
    finishJob(
      job,
      'completed',
      failed > 0 ? `翻译完成，其中 ${failed} 条失败，可继续执行重试` : `翻译完成，共 ${job.done} 条`,
    );
    return;
  }

  let failedInBatch = 0;
  for (const ref of batch) {
    const item = project.groups[ref.group]?.items[ref.item];
    if (!item || item.status !== 'pending') {
      continue;
    }
    const shouldFail = Math.random() < 0.05;
    if (shouldFail) {
      item.status = 'failed';
      item.error = '模拟接口超时，可继续执行重试';
      job.failed += 1;
      failedInBatch += 1;
    } else {
      const source = item.sourceSegments.join('\n');
      item.targetSegments = source.split('\n').map((line) => translateItemText(line));
      item.status = 'done';
      item.error = null;
      job.done += 1;
    }
  }
  job.batchDone += 1;
  job.message = `已完成 ${job.done}/${job.total} 条，失败 ${job.failed} 条`;
  const label = project.groups[batch[0].group]?.id ?? 'batch';
  log(
    job,
    failedInBatch > 0 ? 'warn' : 'info',
    `批次 ${label} 完成：成功 ${batch.length - failedInBatch} 条${
      failedInBatch > 0 ? `，失败 ${failedInBatch} 条` : ''
    }`,
  );
  project.updatedAt = nowIso();
}

function tickGlossary(): void {
  const job = jobStates.glossary;
  if (!project || job.phase !== 'running') {
    return;
  }
  if (job.groupQueue.length === 0) {
    const failed = job.failed;
    finishJob(
      job,
      'completed',
      failed > 0
        ? `术语收集完成，${failed} 个分组失败，可继续执行重试`
        : `术语收集完成，共处理 ${job.done} 个分组，术语表共 ${terms.length} 条`,
    );
    return;
  }

  const groupIndex = job.groupQueue.shift();
  if (groupIndex === undefined) {
    return;
  }
  const group = project.groups[groupIndex];
  if (!group) {
    return;
  }

  if (Math.random() < 0.08) {
    job.failed += 1;
    job.batchDone += 1;
    job.message = `已完成 ${job.done}/${job.total} 个分组，失败 ${job.failed} 个`;
    log(job, 'error', `分组 ${group.id} 抽取失败：模拟接口返回 429，请稍后继续执行`);
    return;
  }

  const text = group.items.map((item) => item.sourceSegments.join('\n')).join('\n');
  let added = 0;
  for (const [sourceJa] of DEMO_GROUPS.flatMap((entry) => entry.entries)) {
    if (!text.includes(sourceJa)) {
      continue;
    }
    const existing = terms.find((term) => normalize(term.source) === normalize(sourceJa));
    if (existing) {
      continue;
    }
    const target = TRANSLATION_MAP.get(sourceJa) ?? '';
    if (!target) {
      continue;
    }
    terms.push({ source: sourceJa, target, note: '示例术语', manual: false });
    added += 1;
    if (added >= 4) {
      break;
    }
  }

  job.done += 1;
  job.batchDone += 1;
  job.message = `已完成 ${job.done}/${job.total} 个分组，失败 ${job.failed} 个`;
  log(
    job,
    'info',
    added > 0 ? `分组 ${group.id} 完成：新增术语 ${added} 个` : `分组 ${group.id} 完成：未发现新的专有名词`,
  );
  const path = project.sourcePath;
  glossaryByPath.set(path, terms.map((term) => ({ ...term })));
  project.updatedAt = nowIso();
}

function ensureNotRunning(job: MockJob, label: string): void {
  if (job.phase === 'running') {
    throw new Error(`${label}任务正在执行中，请先中断当前任务`);
  }
}

// ---------------------------------------------------------------- Backend 实现

export const mockBackend: Backend = {
  async getAppInfo(): Promise<AppInfo> {
    return {
      version: '1.0.0',
      dataDir: '浏览器 localStorage（Mock 数据）',
      workspaceRoot: 'memory://workspaces',
    };
  },

  async getSettings() {
    await delay(80);
    return settingsView();
  },

  async saveSettings(input: SettingsInput) {
    const baseUrl = input.api.baseUrl.trim();
    if (!/^https?:\/\//.test(baseUrl)) {
      throw new Error('baseUrl: API 地址必须以 http:// 或 https:// 开头');
    }
    if (!input.api.model.trim()) {
      throw new Error('model: 模型名称不能为空');
    }
    if (input.translation.concurrency < 1 || input.translation.concurrency > 16) {
      throw new Error('concurrency: 最大并发数需在 1 - 16 之间');
    }
    if (input.translation.maxCharsPerBatch < 200 || input.translation.maxCharsPerBatch > 20000) {
      throw new Error('maxCharsPerBatch: 单批字符上限需在 200 - 20000 之间');
    }
    if (input.translation.maxItemsPerBatch < 1 || input.translation.maxItemsPerBatch > 200) {
      throw new Error('maxItemsPerBatch: 单批条目上限需在 1 - 200 之间');
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(input.appearance.primaryColor)) {
      throw new Error('primaryColor: 主题色必须是 #RRGGBB 格式');
    }

    const apiKey = input.api.clearApiKey
      ? ''
      : input.api.apiKey && input.api.apiKey.trim()
        ? input.api.apiKey.trim()
        : storedSettings.apiKey;

    storedSettings = {
      appearance: input.appearance,
      api: {
        baseUrl,
        model: input.api.model.trim(),
        temperature: input.api.temperature,
        timeoutSecs: input.api.timeoutSecs,
        jsonMode: input.api.jsonMode,
      },
      translation: input.translation,
      apiKey,
    };
    persistSettings();
    await delay(120);
    return settingsView();
  },

  async testConnection(input: ApiSettingsInput) {
    const started = performance.now();
    await delay(650);
    const latencyMs = Math.round(performance.now() - started);
    const baseUrl = input.baseUrl.trim();
    if (!/^https?:\/\//.test(baseUrl)) {
      return {
        ok: false,
        latencyMs,
        endpoint: baseUrl,
        model: input.model,
        message: 'API 地址必须以 http:// 或 https:// 开头',
      };
    }
    if (!input.model.trim()) {
      return {
        ok: false,
        latencyMs,
        endpoint: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
        model: input.model,
        message: '请先填写模型名称',
      };
    }
    const key = input.apiKey?.trim() || storedSettings.apiKey;
    if (baseUrl.includes('openai.com') && !key) {
      return {
        ok: false,
        latencyMs,
        endpoint: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
        model: input.model,
        message: '接口返回 HTTP 401：未提供 API Key（浏览器预览不会发起真实请求）',
      };
    }
    return {
      ok: true,
      latencyMs,
      endpoint: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      model: input.model,
      message: '连接成功（Mock 模拟），模型返回：OK',
    };
  },

  async getRecentProjects() {
    return recentProjects.map((entry) => ({ ...entry }));
  },

  async removeRecentProject(sourcePath: string) {
    recentProjects = recentProjects.filter((entry) => entry.sourcePath !== sourcePath);
    persistRecent();
  },

  async openProject(source: ProjectSource) {
    await delay(400);
    if (source.text) {
      const parsed = parseSource(source.text);
      project = buildProject(source.path, parsed);
      terms = glossaryByPath.get(source.path) ?? [];
    } else if (project && project.sourcePath === source.path) {
      project.updatedAt = nowIso();
    } else if (source.path === DEMO_PATH || !source.path) {
      project = createDemoProject();
      terms = (glossaryByPath.get(project.sourcePath) ?? DEMO_TERMS).map((term) => ({ ...term }));
    } else {
      throw new Error('浏览器预览无法读取本地文件，请重新选择文件或使用桌面版');
    }
    resetJob(jobStates.translate);
    resetJob(jobStates.glossary);
    glossaryByPath.set(project.sourcePath, terms.map((term) => ({ ...term })));
    const value = summary();
    upsertRecent(value);
    return value;
  },

  async getProjectSummary() {
    return summary();
  },

  async setLanguages(sourceLang: string, targetLang: string) {
    if (!project) {
      throw new Error('尚未打开项目');
    }
    project.sourceLang = sourceLang;
    project.targetLang = targetLang;
    project.updatedAt = nowIso();
    return summary();
  },

  async listItems(query: ItemQuery): Promise<ItemPage> {
    if (!project) {
      throw new Error('尚未打开项目');
    }
    const keyword = query.keyword.trim().toLowerCase();
    const items: ItemView[] = [];
    project.groups.forEach((group, groupIndex) => {
      if (query.groupIndex !== null && query.groupIndex !== groupIndex) {
        return;
      }
      group.items.forEach((item, indexInGroup) => {
        if (query.status !== 'all' && item.status !== query.status) {
          return;
        }
        const original = item.sourceSegments.join('\n');
        const translation = item.targetSegments.join('\n');
        if (
          keyword &&
          !original.toLowerCase().includes(keyword) &&
          !translation.toLowerCase().includes(keyword)
        ) {
          return;
        }
        items.push({
          key: `${groupIndex}-${indexInGroup}`,
          group: group.id,
          groupIndex,
          indexInGroup,
          original,
          translation,
          status: item.status,
          error: item.error,
          segmentCount: item.sourceSegments.length,
          skipped: item.skipped,
          hasReference: item.reference !== null,
          manual: item.manual,
        });
      });
    });

    const pageSize = Math.min(Math.max(query.pageSize, 10), 200);
    const page = Math.max(query.page, 1);
    const start = Math.min((page - 1) * pageSize, items.length);
    const counts = projectCounts();
    return {
      total: items.length,
      page,
      pageSize,
      items: items.slice(start, start + pageSize),
      done: counts.doneCount,
      failed: counts.failedCount,
      pending: counts.pendingCount,
    };
  },

  async setItemTranslation(groupIndex: number, indexInGroup: number, translation: string) {
    const item = project?.groups[groupIndex]?.items[indexInGroup];
    if (!project || !item) {
      throw new Error('条目不存在，可能项目已重新加载');
    }
    const trimmed = translation.trimEnd();
    if (item.sourceSegments.length <= 1) {
      item.targetSegments = [trimmed];
    } else {
      const parts = trimmed.split('\n');
      item.targetSegments =
        parts.length === item.sourceSegments.length
          ? parts
          : [trimmed, ...item.sourceSegments.slice(1).map(() => '')];
    }
    item.status = trimmed.trim() ? 'done' : 'pending';
    item.error = null;
    item.reference = null;
    item.skipped = false;
    item.manual = item.status === 'done';
    project.updatedAt = nowIso();
    return summary();
  },

  async exportTranslation(destPath: string): Promise<ExportResult> {
    if (!project) {
      throw new Error('尚未打开项目');
    }
    const payload = project.groups.map((group) => ({
      id: group.id,
      translations: group.items.map((item) => ({
        original: item.original,
        original_sequence: item.sourceSegments,
        translation_sequence: item.targetSegments,
      })),
    }));
    const content = JSON.stringify(payload, null, 2);
    const fileName = baseName(destPath, `${project.fileName}.${project.targetLang}.json`);
    download(fileName, content);
    await delay(300);
    return {
      path: fileName,
      itemCount: payload.reduce((total, group) => total + group.translations.length, 0),
      bytes: new Blob([content]).size,
    };
  },

  async importTranslations(_path: string, text?: string): Promise<ImportReport> {
    if (!project) {
      throw new Error('尚未打开项目');
    }
    if (!text) {
      throw new Error('浏览器预览无法读取本地文件，请在桌面版中导入');
    }
    const parsed = parseSource(text);
    const indexById = new Map<string, number>();
    project.groups.forEach((group, index) => {
      if (!indexById.has(group.id)) {
        indexById.set(group.id, index);
      }
    });
    const report: ImportReport = {
      totalGroups: parsed.length,
      matchedGroups: 0,
      unknownGroups: 0,
      applied: 0,
      skipped: 0,
      mismatched: 0,
    };
    for (const group of parsed) {
      const groupIndex = indexById.get(group.id);
      if (groupIndex === undefined) {
        report.unknownGroups += 1;
        continue;
      }
      report.matchedGroups += 1;
      const target = project.groups[groupIndex];
      group.translations.forEach((translation, index) => {
        const item = target.items[index];
        if (!item) {
          report.skipped += 1;
          return;
        }
        const incomingSource = translation.originalSequence.length
          ? translation.originalSequence
          : [translation.original];
        if (
          incomingSource.join('\n') !== item.sourceSegments.join('\n') &&
          translation.original &&
          translation.original !== item.original
        ) {
          report.mismatched += 1;
          return;
        }
        if (translation.translationSequence.length === 0) {
          report.skipped += 1;
          return;
        }
        const joined = translation.translationSequence.join('\n');
        if (!joined.trim()) {
          report.skipped += 1;
          return;
        }
        item.targetSegments = translation.translationSequence;
        item.status = joined === item.sourceSegments.join('\n') ? 'pending' : 'done';
        item.error = null;
        item.skipped = false;
        item.manual = item.status === 'done';
        report.applied += 1;
      });
    }
    project.updatedAt = nowIso();
    upsertRecent(summary());
    return report;
  },

  async listTerms(query: TermQuery): Promise<TermPage> {
    const keyword = query.keyword.trim().toLowerCase();
    const filtered = terms.filter((term) => {
      if (query.filter === 'translated' && !term.target.trim()) {
        return false;
      }
      if (query.filter === 'untranslated' && term.target.trim()) {
        return false;
      }
      if (query.filter === 'manual' && !term.manual) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return (
        term.source.toLowerCase().includes(keyword) ||
        term.target.toLowerCase().includes(keyword) ||
        term.note.toLowerCase().includes(keyword)
      );
    });
    const pageSize = Math.min(Math.max(query.pageSize, 10), 200);
    const page = Math.max(query.page, 1);
    const start = Math.min((page - 1) * pageSize, filtered.length);
    return {
      total: filtered.length,
      page,
      pageSize,
      items: filtered.slice(start, start + pageSize).map((term) => ({ ...term })),
      translated: terms.filter((term) => term.target.trim()).length,
    };
  },

  async saveTerm(term: GlossaryTerm): Promise<TermSaveResult> {
    if (!project) {
      throw new Error('尚未打开项目');
    }
    const source = term.source.trim();
    if (!source) {
      throw new Error('术语原文不能为空');
    }
    const existing = terms.find((entry) => normalize(entry.source) === normalize(source));
    if (existing) {
      existing.source = source;
      existing.target = term.target.trim();
      existing.note = term.note.trim();
      existing.manual = true;
    } else {
      terms.push({
        source,
        target: term.target.trim(),
        note: term.note.trim(),
        manual: true,
      });
    }
    glossaryByPath.set(project.sourcePath, terms.map((entry) => ({ ...entry })));
    project.updatedAt = nowIso();
    return {
      term: { ...(existing ?? terms[terms.length - 1]) },
      summary: summary(),
    };
  },

  async deleteTerms(sources: string[]) {
    if (!project) {
      throw new Error('尚未打开项目');
    }
    const targets = new Set(sources.map((source) => normalize(source)));
    terms = terms.filter((term) => !targets.has(normalize(term.source)));
    glossaryByPath.set(project.sourcePath, terms.map((term) => ({ ...term })));
    project.updatedAt = nowIso();
    return summary();
  },

  async importGlossary(
    _path: string,
    mode: 'merge' | 'replace',
    text?: string,
  ): Promise<GlossaryImportReport> {
    if (!project) {
      throw new Error('尚未打开项目');
    }
    if (!text) {
      throw new Error('浏览器预览无法读取本地文件，请在桌面版中导入');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new Error(`术语表不是合法的 JSON：${(error as Error).message}`);
    }
    const list = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.terms)
        ? parsed.terms
        : null;
    if (!list) {
      throw new Error('术语表结构无效，应为数组或包含 terms 字段的对象');
    }

    const conflicts: string[] = [];
    if (mode === 'replace') {
      terms = [];
    }
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const seen = new Set<string>();
    for (const entry of list) {
      if (!isRecord(entry)) {
        skipped += 1;
        continue;
      }
      const source = asString(entry.source) || asString(entry.original);
      const target = asString(entry.target) || asString(entry.translation);
      const note = asString(entry.note) || asString(entry.remark);
      const key = normalize(source);
      if (!key || seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      const existing = terms.find((term) => normalize(term.source) === key);
      if (!existing) {
        terms.push({ source: source.trim(), target: target.trim(), note: note.trim(), manual: true });
        added += 1;
        continue;
      }
      if (existing.manual && existing.target && target && existing.target !== target) {
        if (conflicts.length < 20) {
          conflicts.push(`${existing.source}：保留“${existing.target}”，忽略导入的“${target}”`);
        }
        skipped += 1;
        continue;
      }
      if (target.trim()) {
        existing.target = target.trim();
      }
      if (note.trim()) {
        existing.note = note.trim();
      }
      existing.manual = true;
      updated += 1;
    }
    glossaryByPath.set(project.sourcePath, terms.map((term) => ({ ...term })));
    project.updatedAt = nowIso();
    await delay(200);
    return {
      total: list.length,
      added,
      updated,
      skipped,
      replaced: mode === 'replace',
      conflicts,
      termsTotal: terms.length,
    };
  },

  async exportGlossary(destPath: string) {
    const payload = {
      terms: terms.map((term) => ({
        source: term.source,
        target: term.target,
        note: term.note,
      })),
    };
    download(baseName(destPath, 'glossary.json'), JSON.stringify(payload, null, 2));
    await delay(200);
    return destPath;
  },

  async startGlossaryJob(restart: boolean) {
    if (!project) {
      throw new Error('尚未打开项目');
    }
    const job = jobStates.glossary;
    ensureNotRunning(job, '术语收集');
    if (job.timer !== null) {
      window.clearInterval(job.timer);
      job.timer = null;
    }
    if (restart) {
      glossaryByPath.set(project.sourcePath, []);
    }
    const pending: number[] = [];
    project.groups.forEach((group, index) => {
      const hasText = group.items.some((item) =>
        item.sourceSegments.some((segment) => /[a-zA-Z\u3040-\u30ff\u4e00-\u9fff]/.test(segment)),
      );
      if (hasText) {
        pending.push(index);
      }
    });
    if (pending.length === 0) {
      throw new Error('没有可收集术语的分组');
    }
    Object.assign(job, createJob());
    job.phase = 'running';
    job.total = pending.length;
    job.groupQueue = pending;
    job.batchTotal = pending.length;
    job.startedAt = nowIso();
    job.startedAtMs = Date.now();
    job.message = `准备收集 ${pending.length} 个分组的术语`;
    log(job, 'info', `任务开始：${pending.length} 个分组，并发 3（Mock 模拟）`);
    job.timer = window.setInterval(tickGlossary, 420);
    tickGlossary();
  },

  async startTranslateJob(restart: boolean) {
    if (!project) {
      throw new Error('尚未打开项目');
    }
    const job = jobStates.translate;
    ensureNotRunning(job, '翻译');
    if (job.timer !== null) {
      window.clearInterval(job.timer);
      job.timer = null;
    }
    if (restart) {
      for (const group of project.groups) {
        for (const item of group.items) {
          const source = item.sourceSegments.join('\n');
          const translation = item.targetSegments.join('\n');
          if (translation.trim() && translation !== source) {
            item.reference = [...item.targetSegments];
          }
          item.targetSegments = [...item.sourceSegments];
          item.status = 'pending';
          item.error = null;
          item.skipped = false;
          item.manual = false;
        }
      }
    } else {
      for (const group of project.groups) {
        for (const item of group.items) {
          if (item.status === 'failed') {
            item.status = 'pending';
            item.error = null;
            item.skipped = false;
          }
        }
      }
    }

    Object.assign(job, createJob());
    job.phase = 'running';
    job.startedAt = nowIso();
    job.startedAtMs = Date.now();
    const skipped = queueTranslateItems(job);
    job.failed = skipped;
    if (job.queue.length === 0) {
      finishJob(
        job,
        'completed',
        skipped > 0 ? `没有可翻译条目，${skipped} 条超长文本已被跳过` : '没有需要翻译的条目',
      );
      return;
    }
    log(
      job,
      'info',
      `任务开始：${job.total} 条待翻译，${job.batchTotal} 个批次，并发 3（Mock 模拟）`,
    );
    job.timer = window.setInterval(tickTranslate, 340);
    tickTranslate();
  },

  async stopJob(kind: JobKind) {
    const job = jobStates[kind];
    if (job.phase !== 'running') {
      return;
    }
    if (job.timer !== null) {
      window.clearInterval(job.timer);
      job.timer = null;
    }
    job.elapsedSecs = job.startedAtMs ? Math.round((Date.now() - job.startedAtMs) / 1000) : 0;
    job.startedAtMs = null;
    job.phase = 'paused';
    job.message = `任务已中断；已完成 ${job.done} 条，失败 ${job.failed} 条，可继续执行`;
    job.finishedAt = nowIso();
    job.running = 0;
    log(job, 'warn', '收到中断请求，已取消在途请求');
  },

  async jobSnapshots(): Promise<JobSnapshots> {
    return {
      glossary: jobSnapshot('glossary'),
      translate: jobSnapshot('translate'),
    };
  },

  async clearJobLogs(kind: JobKind) {
    jobStates[kind].logs = [];
  },
};
