import type { SettingsInput } from '@/types';

export type FieldErrors = Record<string, string>;

const isIntegerInRange = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;

/** 允许小数的范围校验（如以秒为单位的超时、重试间隔）。 */
const isNumberInRange = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max;

/** 与后端保持一致的设置校验，用于字段级提示。 */
export function validateSettings(input: SettingsInput): FieldErrors {
  const errors: FieldErrors = {};
  const { appearance, api, translation } = input;

  if (!/^#[0-9a-fA-F]{6}$/.test(appearance.primaryColor)) {
    errors.primaryColor = '主题色必须为 #RRGGBB 格式';
  }
  if (!(appearance.fontSize >= 12 && appearance.fontSize <= 20)) {
    errors.fontSize = '字号需在 12 - 20 之间';
  }
  if (!appearance.fontFamily.trim()) {
    errors.fontFamily = '请选择字体';
  }

  const baseUrl = api.baseUrl.trim();
  if (!baseUrl) {
    errors.baseUrl = 'API 地址不能为空';
  } else if (!/^https?:\/\//.test(baseUrl)) {
    errors.baseUrl = 'API 地址必须以 http:// 或 https:// 开头';
  } else {
    try {
      new URL(baseUrl);
    } catch {
      errors.baseUrl = 'API 地址格式无效';
    }
  }
  if (!api.model.trim()) {
    errors.model = '模型名称不能为空';
  }
  if (!(api.temperature >= 0 && api.temperature <= 2)) {
    errors.temperature = 'Temperature 需在 0 - 2 之间';
  }
  if (!isNumberInRange(api.timeoutSecs, 1, 600)) {
    errors.timeoutSecs = '请求超时需在 1 - 600 秒之间';
  }

  if (!isIntegerInRange(translation.concurrency, 1, 500)) {
    errors.concurrency = '并发数需在 1 - 500 之间';
  }
  if (!isIntegerInRange(translation.maxCharsPerBatch, 100, 100000)) {
    errors.maxCharsPerBatch = '单批字符上限需在 100 - 100000 之间';
  }
  if (!isIntegerInRange(translation.maxItemsPerBatch, 1, 1000)) {
    errors.maxItemsPerBatch = '单批条目上限需在 1 - 1000 之间';
  }
  if (!isIntegerInRange(translation.retryTimes, 0, 100)) {
    errors.retryTimes = '重试次数需在 0 - 100 之间';
  }
  if (!isIntegerInRange(translation.backoffMs, 0, 300000)) {
    errors.backoffMs = '重试间隔需在 0 - 300 秒之间';
  }
  if (!isIntegerInRange(translation.glossaryBatchChars, 100, 100000)) {
    errors.glossaryBatchChars = '术语单批字符上限需在 100 - 100000 之间';
  }
  if (!isIntegerInRange(translation.glossaryBatchItems, 1, 1000)) {
    errors.glossaryBatchItems = '术语单批条目上限需在 1 - 1000 之间';
  }
  if ([...translation.systemPrompt].length > 10000) {
    errors.systemPrompt = '额外系统提示词不能超过 10000 字符';
  }
  if ([...translation.userPrompt].length > 10000) {
    errors.userPrompt = '额外用户提示词不能超过 10000 字符';
  }

  return errors;
}
