import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ApiOutlinedIcon from '@mui/icons-material/ApiOutlined';
import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import LightModeIcon from '@mui/icons-material/LightMode';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import WifiTetheringIcon from '@mui/icons-material/WifiTethering';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { api, isDesktop } from '@/api';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { useAppStore } from '@/store/useAppStore';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_API_INPUT,
  DEFAULT_TRANSLATION_SETTINGS,
  FONT_OPTIONS,
  PRIMARY_COLORS,
  type ApiSettingsInput,
  type ApiSettingsView,
  type AppearanceSettings,
  type SettingsInput,
  type SettingsView,
  type TestConnectionResult,
  type TranslationSettings,
} from '@/types';
import { errorMessage } from '@/utils/format';
import { FONT_STACKS, MONO_FONT_STACK } from '@/theme';
import { type FieldErrors, validateSettings } from '@/utils/validation';

interface DraftApi {
  baseUrl: string;
  model: string;
  temperature: number;
  timeoutSecs: number;
  jsonMode: boolean;
}

interface Draft {
  appearance: AppearanceSettings;
  api: DraftApi;
  translation: TranslationSettings;
}

const DEFAULT_DRAFT: Draft = {
  appearance: { ...DEFAULT_APPEARANCE },
  api: { ...DEFAULT_API_INPUT },
  translation: { ...DEFAULT_TRANSLATION_SETTINGS },
};

function toApiInput(view: ApiSettingsView): ApiSettingsInput {
  return {
    baseUrl: view.baseUrl,
    model: view.model,
    temperature: view.temperature,
    timeoutSecs: view.timeoutSecs,
    jsonMode: view.jsonMode,
    clearApiKey: false,
  };
}

function buildDraft(settings: SettingsView): Draft {
  return {
    appearance: { ...settings.appearance },
    api: toApiInput(settings.api),
    translation: { ...settings.translation },
  };
}

const numberValue = (value: string, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** 秒数 → 输入框文本：去掉多余的小数 0（120 → "120"，1.5 → "1.5"）。 */
const secondsText = (value: number): string => `${Number(value.toFixed(3))}`;

/** 毫秒 → 秒文本。 */
const msToSecondsText = (ms: number): string => `${Number((ms / 1000).toFixed(3))}`;

function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
      }}
    >
      {children}
    </Box>
  );
}

export default function SettingsPage() {
  const settings = useAppStore((state) => state.settings);
  const appInfo = useAppStore((state) => state.appInfo);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const previewAppearance = useAppStore((state) => state.previewAppearance);
  const notify = useAppStore((state) => state.notify);

  const [tab, setTab] = useState(0);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [appearanceDirty, setAppearanceDirty] = useState(false);
  // 支持小数的秒输入需要保留原始文本，否则输入 "1." 时会被数字回写吃掉小数点
  const [timeoutText, setTimeoutText] = useState('120');
  const [backoffText, setBackoffText] = useState('1.5');

  const initialised = useRef(false);
  const savedAppearance = useRef('');

  useEffect(() => {
    if (!settings) {
      return;
    }
    const syncSeconds = () => {
      setTimeoutText(secondsText(settings.api.timeoutSecs));
      setBackoffText(msToSecondsText(settings.translation.backoffMs));
    };
    if (!initialised.current) {
      initialised.current = true;
      savedAppearance.current = JSON.stringify(settings.appearance);
      setDraft(buildDraft(settings));
      syncSeconds();
      return;
    }
    if (!dirty) {
      setDraft(buildDraft(settings));
      syncSeconds();
    }
  }, [settings, dirty]);

  // 外观修改立即生效，并在停止操作后自动保存
  useEffect(() => {
    if (!appearanceDirty || !settings) {
      return undefined;
    }
    const serialized = JSON.stringify(draft.appearance);
    if (serialized === savedAppearance.current) {
      setAppearanceDirty(false);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      const ok = await saveSettings({
        appearance: draft.appearance,
        api: toApiInput(settings.api),
        translation: settings.translation,
      });
      if (ok) {
        savedAppearance.current = serialized;
        setAppearanceDirty(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [appearanceDirty, draft.appearance, settings, saveSettings]);

  const patchAppearance = (patch: Partial<AppearanceSettings>) => {
    const appearance = { ...draft.appearance, ...patch };
    setDraft((current) => ({ ...current, appearance }));
    previewAppearance(appearance);
    setAppearanceDirty(true);
  };

  const patchApi = (patch: Partial<DraftApi>) => {
    setDraft((current) => ({ ...current, api: { ...current.api, ...patch } }));
    setDirty(true);
    setErrors({});
  };

  const patchTranslation = (patch: Partial<TranslationSettings>) => {
    setDraft((current) => ({ ...current, translation: { ...current.translation, ...patch } }));
    setDirty(true);
    setErrors({});
  };

  const handleSave = async () => {
    if (!settings) {
      return;
    }
    const input: SettingsInput = {
      appearance: draft.appearance,
      api: {
        ...draft.api,
        apiKey: apiKey.trim() ? apiKey.trim() : undefined,
        clearApiKey,
      },
      translation: draft.translation,
    };
    const nextErrors = validateSettings(input);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const onApiTab = Boolean(
        nextErrors.baseUrl || nextErrors.model || nextErrors.temperature || nextErrors.timeoutSecs,
      );
      setTab(onApiTab ? 1 : 2);
      notify('error', '设置未保存，请先修正表单中的错误');
      return;
    }
    setSaving(true);
    const ok = await saveSettings(input);
    setSaving(false);
    if (ok) {
      savedAppearance.current = JSON.stringify(draft.appearance);
      setApiKey('');
      setClearApiKey(false);
      setShowKey(false);
      setDirty(false);
      setAppearanceDirty(false);
      setTestResult(null);
      notify('success', '设置已保存并立即生效');
    }
  };

  const handleTestConnection = async () => {
    if (!settings) {
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testConnection({
        ...draft.api,
        apiKey: apiKey.trim() ? apiKey.trim() : undefined,
        clearApiKey,
      });
      setTestResult(result);
      notify(result.ok ? 'success' : 'error', result.ok ? '接口连接正常' : '接口连接失败');
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setTesting(false);
    }
  };

  if (!settings) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const errorOf = (field: string): string | undefined => errors[field];

  return (
    <>
      <PageHeader
        icon={<SettingsOutlinedIcon />}
        title="全局设置"
        description="外观设置会即时预览并自动保存；接口与翻译参数保存后对后续任务生效。"
        actions={
          dirty || appearanceDirty ? (
            <>
              <Chip color="warning" variant="outlined" label="有未保存的修改" />
              <Button
                variant="contained"
                startIcon={<SaveOutlinedIcon />}
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? '保存中…' : '保存设置'}
              </Button>
            </>
          ) : (
            <Chip color="success" variant="outlined" icon={<CheckCircleOutlineIcon />} label="设置已保存" />
          )
        }
      />

      <Paper variant="outlined" sx={{ mb: 2.5 }}>
        <Tabs value={tab} onChange={(_event, value: number) => setTab(value)} sx={{ px: 1 }}>
          <Tab icon={<PaletteOutlinedIcon fontSize="small" />} iconPosition="start" label="外观" />
          <Tab icon={<ApiOutlinedIcon fontSize="small" />} iconPosition="start" label="AI 接口" />
          <Tab icon={<TuneOutlinedIcon fontSize="small" />} iconPosition="start" label="翻译设置" />
        </Tabs>
      </Paper>

      {tab === 0 && (
        <Stack spacing={2.5}>
          <SectionCard title="主题模式" subtitle="跟随系统时会自动响应 Windows 的深色模式设置">
            <ToggleButtonGroup
              exclusive
              value={draft.appearance.themeMode}
              onChange={(_event, value: AppearanceSettings['themeMode'] | null) =>
                value && patchAppearance({ themeMode: value })
              }
              size="small"
            >
              <ToggleButton value="light" sx={{ gap: 1 }}>
                <LightModeIcon fontSize="small" /> 浅色
              </ToggleButton>
              <ToggleButton value="dark" sx={{ gap: 1 }}>
                <DarkModeIcon fontSize="small" /> 深色
              </ToggleButton>
              <ToggleButton value="system" sx={{ gap: 1 }}>
                <BrightnessAutoIcon fontSize="small" /> 跟随系统
              </ToggleButton>
            </ToggleButtonGroup>
          </SectionCard>

          <SectionCard title="主题色" subtitle="统一应用于按钮、进度条、选中态与强调信息">
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              {PRIMARY_COLORS.map((color) => {
                const selected = draft.appearance.primaryColor.toLowerCase() === color.toLowerCase();
                return (
                  <Tooltip key={color} title={color}>
                    <Box
                      component="button"
                      type="button"
                      aria-label={`选择主题色 ${color}`}
                      aria-pressed={selected}
                      onClick={() => patchAppearance({ primaryColor: color })}
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        border: 2,
                        borderColor: selected ? 'text.primary' : 'transparent',
                        boxShadow: selected
                          ? `0 0 0 3px ${alpha('#3B82F6', 0.22)}`
                          : 'none',
                        background: color,
                        cursor: 'pointer',
                        p: 0,
                      }}
                    />
                  </Tooltip>
                );
              })}
              <TextField
                label="自定义颜色"
                value={draft.appearance.primaryColor}
                onChange={(event) => patchAppearance({ primaryColor: event.target.value })}
                error={Boolean(errorOf('primaryColor'))}
                helperText={errorOf('primaryColor')}
                sx={{ width: 160, ml: { xs: 0, sm: 1 } }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <Box
                          component="input"
                          type="color"
                          aria-label="选择自定义主题色"
                          value={
                            /^#[0-9a-fA-F]{6}$/.test(draft.appearance.primaryColor)
                              ? draft.appearance.primaryColor
                              : '#3B82F6'
                          }
                          onChange={(event) => patchAppearance({ primaryColor: event.target.value })}
                          sx={{
                            width: 24,
                            height: 24,
                            p: 0,
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                          }}
                        />
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </Box>
          </SectionCard>

          <SectionCard title="密度与字体" subtitle="紧凑模式会统一调整控件高度、表格行距与间距，而不仅仅是缩小字号">
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  密度模式
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={draft.appearance.density}
                  onChange={(_event, value: AppearanceSettings['density'] | null) =>
                    value && patchAppearance({ density: value })
                  }
                >
                  <ToggleButton value="comfortable">舒适</ToggleButton>
                  <ToggleButton value="compact">紧凑</ToggleButton>
                </ToggleButtonGroup>
              </Box>

              <FieldGrid>
                <TextField
                  select
                  label="界面字体"
                  value={draft.appearance.fontFamily}
                  onChange={(event) => patchAppearance({ fontFamily: event.target.value })}
                  error={Boolean(errorOf('fontFamily'))}
                  helperText={errorOf('fontFamily') || '日志与原文区域固定使用等宽字体保证可读性'}
                >
                  {FONT_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Box>
                  <Typography variant="body2" gutterBottom>
                    字号：{draft.appearance.fontSize} px
                  </Typography>
                  <Slider
                    value={draft.appearance.fontSize}
                    onChange={(_event, value) =>
                      patchAppearance({ fontSize: Array.isArray(value) ? value[0] : value })
                    }
                    min={12}
                    max={20}
                    step={1}
                    marks={[
                      { value: 12, label: '12' },
                      { value: 14, label: '14' },
                      { value: 16, label: '16' },
                      { value: 20, label: '20' },
                    ]}
                    valueLabelDisplay="auto"
                    aria-label="界面字号"
                  />
                </Box>
              </FieldGrid>

              <Paper
                variant="outlined"
                sx={{ p: 2, bgcolor: 'background.default', borderRadius: 1 }}
              >
                <Typography variant="subtitle2" gutterBottom>
                  预览
                </Typography>
                <Typography
                  variant="body1"
                  sx={{ fontFamily: FONT_STACKS[draft.appearance.fontFamily] }}
                >
                  佐伯：今日はいい天気だね。散歩でも行こうか。
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ fontFamily: FONT_STACKS[draft.appearance.fontFamily], mt: 0.5 }}
                >
                  佐伯：今天天气不错，要不去散散步吧。
                </Typography>
                <Box
                  sx={{
                    mt: 1,
                    p: 1,
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    fontFamily: MONO_FONT_STACK,
                    fontSize: 12,
                  }}
                >
                  [信息] 批次 dataActors#0 完成：12 条，注入术语 3 个
                </Box>
              </Paper>
            </Stack>
          </SectionCard>
        </Stack>
      )}

      {tab === 1 && (
        <Stack spacing={2.5}>
          <SectionCard
            title="接口配置"
            subtitle="兼容任意 OpenAI Chat Completions 协议的服务，包括本地部署模型"
          >
            <Stack spacing={2}>
              <TextField
                label="API Base URL"
                value={draft.api.baseUrl}
                onChange={(event) => patchApi({ baseUrl: event.target.value })}
                error={Boolean(errorOf('baseUrl'))}
                helperText={
                  errorOf('baseUrl') ||
                  '示例：https://api.openai.com/v1；也支持直接填写完整的 /chat/completions 地址'
                }
                placeholder="https://api.openai.com/v1"
                fullWidth
              />
              <TextField
                label="API Key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setClearApiKey(false);
                  setDirty(true);
                }}
                placeholder={
                  settings.api.hasApiKey
                    ? `已保存（${settings.api.apiKeyMasked}），留空则保持不变`
                    : '未配置，本地模型可留空'
                }
                helperText="密钥仅保存在本机设置文件，不会写入项目数据、导出文件或运行日志"
                fullWidth
                autoComplete="off"
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                          onClick={() => setShowKey((value) => !value)}
                          edge="end"
                          size="small"
                        >
                          {showKey ? (
                            <VisibilityOffOutlinedIcon fontSize="small" />
                          ) : (
                            <VisibilityOutlinedIcon fontSize="small" />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              {settings.api.hasApiKey && !clearApiKey && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                    当前已保存密钥。若更换服务地址，请同时更新 API Key。
                  </Typography>
                  <Button
                    size="small"
                    color="warning"
                    onClick={() => {
                      setClearApiKey(true);
                      setApiKey('');
                      setDirty(true);
                    }}
                  >
                    清除已保存的密钥
                  </Button>
                </Box>
              )}
              {clearApiKey && (
                <Alert
                  severity="warning"
                  variant="outlined"
                  action={
                    <Button size="small" onClick={() => setClearApiKey(false)}>
                      撤销
                    </Button>
                  }
                >
                  保存后将删除本机已保存的 API Key。
                </Alert>
              )}

              <FieldGrid>
                <TextField
                  label="模型名称"
                  value={draft.api.model}
                  onChange={(event) => patchApi({ model: event.target.value })}
                  error={Boolean(errorOf('model'))}
                  helperText={errorOf('model') || '例如 gpt-4o-mini、deepseek-chat'}
                />
                <TextField
                  label="请求超时（秒）"
                  type="text"
                  value={timeoutText}
                  onChange={(event) => {
                    const text = event.target.value;
                    setTimeoutText(text);
                    const parsed = Number(text);
                    patchApi({
                      timeoutSecs: text.trim() === '' || !Number.isFinite(parsed) ? 0 : parsed,
                    });
                  }}
                  onBlur={() => {
                    const parsed = Number(timeoutText);
                    if (timeoutText.trim() !== '' && Number.isFinite(parsed)) {
                      setTimeoutText(secondsText(parsed));
                    }
                  }}
                  error={Boolean(errorOf('timeoutSecs'))}
                  helperText={
                    errorOf('timeoutSecs') || '支持小数，范围 1 - 600 秒；超时后按重试策略重新请求'
                  }
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                />
              </FieldGrid>

              <Box>
                <Typography variant="body2" gutterBottom>
                  Temperature：{draft.api.temperature.toFixed(1)}
                </Typography>
                <Slider
                  value={draft.api.temperature}
                  onChange={(_event, value) =>
                    patchApi({ temperature: Array.isArray(value) ? value[0] : value })
                  }
                  min={0}
                  max={2}
                  step={0.1}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 0.3, label: '0.3' },
                    { value: 1, label: '1' },
                    { value: 2, label: '2' },
                  ]}
                  valueLabelDisplay="auto"
                  aria-label="Temperature"
                />
              </Box>

              <FormControlLabel
                control={
                  <Switch
                    checked={draft.api.jsonMode}
                    onChange={(event) => patchApi({ jsonMode: event.target.checked })}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">JSON 模式</Typography>
                    <Typography variant="caption" color="text.secondary">
                      发送 response_format=json_object；部分兼容接口不支持时可关闭
                    </Typography>
                  </Box>
                }
              />

              <Divider />

              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  startIcon={<WifiTetheringIcon />}
                  onClick={() => void handleTestConnection()}
                  disabled={testing || saving}
                >
                  {testing ? '正在测试…' : '测试连接'}
                </Button>
              </Box>

              {testResult && (
                <Alert
                  severity={testResult.ok ? 'success' : 'error'}
                  variant="outlined"
                  onClose={() => setTestResult(null)}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {testResult.message}
                  </Typography>
                  <Typography variant="caption" component="div" color="text.secondary">
                    地址：{testResult.endpoint} · 模型：{testResult.model} · 耗时：{testResult.latencyMs} ms
                  </Typography>
                </Alert>
              )}
            </Stack>
          </SectionCard>
        </Stack>
      )}

      {tab === 2 && (
        <Stack spacing={2.5}>
          <SectionCard title="并发与批次" subtitle="批次的划分由单批字符与条目上限共同决定">
            <FieldGrid>
              <TextField
                label="最大并发请求数"
                type="number"
                value={draft.translation.concurrency}
                onChange={(event) =>
                  patchTranslation({ concurrency: numberValue(event.target.value) })
                }
                error={Boolean(errorOf('concurrency'))}
                helperText={errorOf('concurrency') || '范围 1 - 500，默认 10；过高可能触发接口限流'}
                slotProps={{ htmlInput: { min: 1, max: 500 } }}
              />
              <TextField
                label="失败重试次数"
                type="number"
                value={draft.translation.retryTimes}
                onChange={(event) =>
                  patchTranslation({ retryTimes: numberValue(event.target.value) })
                }
                error={Boolean(errorOf('retryTimes'))}
                helperText={errorOf('retryTimes') || '范围 0 - 100；网络错误、超时、限流与解析失败会自动重试'}
                slotProps={{ htmlInput: { min: 0, max: 100 } }}
              />
              <TextField
                label="单批字符上限"
                type="number"
                value={draft.translation.maxCharsPerBatch}
                onChange={(event) =>
                  patchTranslation({ maxCharsPerBatch: numberValue(event.target.value) })
                }
                error={Boolean(errorOf('maxCharsPerBatch'))}
                helperText={errorOf('maxCharsPerBatch') || '范围 100 - 100000，默认 4000；超长文本按 6 倍上限判定'}
                slotProps={{ htmlInput: { min: 100, max: 100000, step: 100 } }}
              />
              <TextField
                label="单批条目上限"
                type="number"
                value={draft.translation.maxItemsPerBatch}
                onChange={(event) =>
                  patchTranslation({ maxItemsPerBatch: numberValue(event.target.value) })
                }
                error={Boolean(errorOf('maxItemsPerBatch'))}
                helperText={errorOf('maxItemsPerBatch') || '范围 1 - 1000，默认 40；条目越多单次耗时越长'}
                slotProps={{ htmlInput: { min: 1, max: 1000 } }}
              />
            </FieldGrid>
          </SectionCard>

          <SectionCard title="容错与重试" subtitle="区分可重试错误与不可重试错误">
            <FieldGrid>
              <TextField
                select
                label="重试退避策略"
                value={draft.translation.backoffStrategy}
                onChange={(event) =>
                  patchTranslation({
                    backoffStrategy: event.target.value as TranslationSettings['backoffStrategy'],
                  })
                }
              >
                <MenuItem value="none">固定间隔</MenuItem>
                <MenuItem value="linear">线性递增</MenuItem>
                <MenuItem value="exponential">指数递增</MenuItem>
              </TextField>
              <TextField
                label="重试基础间隔（秒）"
                type="text"
                value={backoffText}
                onChange={(event) => {
                  const text = event.target.value;
                  setBackoffText(text);
                  const parsed = Number(text);
                  patchTranslation({
                    backoffMs:
                      text.trim() === '' || !Number.isFinite(parsed)
                        ? 0
                        : Math.round(parsed * 1000),
                  });
                }}
                onBlur={() => {
                  const parsed = Number(backoffText);
                  if (Number.isFinite(parsed)) {
                    setBackoffText(msToSecondsText(Math.round(parsed * 1000)));
                  }
                }}
                error={Boolean(errorOf('backoffMs'))}
                helperText={
                  errorOf('backoffMs') ||
                  '支持小数，范围 0 - 300 秒；指数策略下按 1x / 2x / 4x 递增'
                }
                disabled={draft.translation.backoffStrategy === 'none'}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
              <TextField
                select
                label="超长文本策略"
                value={draft.translation.longTextStrategy}
                onChange={(event) =>
                  patchTranslation({
                    longTextStrategy: event.target.value as TranslationSettings['longTextStrategy'],
                  })
                }
                helperText="超过单批字符上限 6 倍的文本（例如内嵌 JSON）"
              >
                <MenuItem value="skip">跳过并标记失败（默认）</MenuItem>
                <MenuItem value="isolate">单独成批翻译</MenuItem>
              </TextField>
              <FormControlLabel
                sx={{ alignItems: 'flex-start', m: 0, mt: 1 }}
                control={
                  <Switch
                    checked={draft.translation.continueOnBatchError}
                    onChange={(event) =>
                      patchTranslation({ continueOnBatchError: event.target.checked })
                    }
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">批次失败后继续处理其他批次</Typography>
                    <Typography variant="caption" color="text.secondary">
                      关闭后遇到不可重试错误会立即停止任务，便于排查配置问题
                    </Typography>
                  </Box>
                }
              />
            </FieldGrid>
          </SectionCard>

          <SectionCard title="术语注入" subtitle="只注入当前批次原文命中的术语，避免提示词膨胀">
            <FieldGrid>
              <TextField
                select
                label="注入策略"
                value={draft.translation.glossaryInjection}
                onChange={(event) =>
                  patchTranslation({
                    glossaryInjection: event.target.value as TranslationSettings['glossaryInjection'],
                  })
                }
              >
                <MenuItem value="off">不注入术语</MenuItem>
                <MenuItem value="matched">注入命中的术语（推荐）</MenuItem>
                <MenuItem value="matchedWithNote">注入术语并附带分类备注</MenuItem>
              </TextField>
              <TextField
                label="术语收集单批字符上限"
                type="number"
                value={draft.translation.glossaryBatchChars}
                onChange={(event) =>
                  patchTranslation({ glossaryBatchChars: numberValue(event.target.value) })
                }
                error={Boolean(errorOf('glossaryBatchChars'))}
                helperText={errorOf('glossaryBatchChars') || '范围 100 - 100000'}
                slotProps={{ htmlInput: { min: 100, max: 100000, step: 100 } }}
              />
              <TextField
                label="术语收集单批条目上限"
                type="number"
                value={draft.translation.glossaryBatchItems}
                onChange={(event) =>
                  patchTranslation({ glossaryBatchItems: numberValue(event.target.value) })
                }
                error={Boolean(errorOf('glossaryBatchItems'))}
                helperText={errorOf('glossaryBatchItems') || '范围 1 - 1000'}
                slotProps={{ htmlInput: { min: 1, max: 1000 } }}
              />
            </FieldGrid>
          </SectionCard>

          <SectionCard title="额外提示词" subtitle="会追加到内置提示词之后，用于补充世界观、语气或格式要求">
            <Stack spacing={2}>
              <TextField
                label="额外系统提示词"
                value={draft.translation.systemPrompt}
                onChange={(event) => patchTranslation({ systemPrompt: event.target.value })}
                multiline
                minRows={3}
                error={Boolean(errorOf('systemPrompt'))}
                helperText={
                  errorOf('systemPrompt') ||
                  `${[...draft.translation.systemPrompt].length} / 10000 字符 · 例如：本作角色多用关西腔，请保持轻松口语化表达`
                }
                fullWidth
              />
              <TextField
                label="额外用户提示词"
                value={draft.translation.userPrompt}
                onChange={(event) => patchTranslation({ userPrompt: event.target.value })}
                multiline
                minRows={2}
                error={Boolean(errorOf('userPrompt'))}
                helperText={
                  errorOf('userPrompt') ||
                  `${[...draft.translation.userPrompt].length} / 10000 字符 · 会随每次翻译请求发送，请勿写入敏感信息`
                }
                fullWidth
              />
              <Box>
                <Button
                  variant="text"
                  startIcon={<RestartAltIcon />}
                  onClick={() => {
                    setDraft((current) => ({
                      ...current,
                      translation: { ...DEFAULT_TRANSLATION_SETTINGS },
                    }));
                    setDirty(true);
                    notify('info', '已恢复翻译设置的默认值，保存后生效');
                  }}
                >
                  恢复翻译默认值
                </Button>
              </Box>
            </Stack>
          </SectionCard>
        </Stack>
      )}

      <Box sx={{ mt: 2.5 }}>
        <SectionCard title="数据与版本" subtitle="所有数据保存在本机应用数据目录">
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                数据目录
              </Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                {appInfo?.dataDir ?? '—'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip size="small" variant="outlined" label={`版本 ${appInfo?.version ?? '1.0.0'}`} />
              <Button
                size="small"
                startIcon={<FolderOpenOutlinedIcon />}
                disabled={!isDesktop || !appInfo}
                onClick={async () => {
                  if (!appInfo) {
                    return;
                  }
                  try {
                    await revealItemInDir(appInfo.dataDir);
                  } catch (error) {
                    notify('error', errorMessage(error));
                  }
                }}
              >
                打开数据目录
              </Button>
            </Box>
          </Stack>
        </SectionCard>
      </Box>
    </>
  );
}
