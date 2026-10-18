import { open, save } from '@tauri-apps/plugin-dialog';

import { isDesktop } from '@/api';

export interface PickedFile {
  path: string;
  /** 浏览器环境读取到的文件内容，桌面端由 Rust 直接读取。 */
  text?: string;
}

const JSON_FILTER = [{ name: 'JSON 文件', extensions: ['json'] }];

/** 选择本地 JSON 文件；桌面端返回路径，浏览器端返回路径与内容。 */
export async function pickJsonFile(title = '选择 JSON 文件'): Promise<PickedFile | null> {
  if (isDesktop) {
    const selected = await open({
      multiple: false,
      directory: false,
      title,
      filters: JSON_FILTER,
    });
    if (typeof selected !== 'string') {
      return null;
    }
    return { path: selected };
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = () => {
      input.remove();
      window.removeEventListener('focus', handleFocus);
    };

    let resolved = false;
    const finish = (value: PickedFile | null) => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      resolve(value);
    };

    function handleFocus() {
      // 用户取消文件选择时不会触发 change，聚焦回窗口后延迟结束
      window.setTimeout(() => finish(null), 500);
    }

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      try {
        const text = await file.text();
        finish({ path: file.name, text });
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error('读取文件失败'));
      }
    });

    window.addEventListener('focus', handleFocus, { once: true });
    input.click();
  });
}

/** 选择保存位置；浏览器端直接返回默认文件名并触发下载。 */
export async function pickSavePath(
  defaultName: string,
  title = '导出 JSON 文件',
): Promise<string | null> {
  if (!isDesktop) {
    return defaultName;
  }
  const path = await save({
    defaultPath: defaultName,
    title,
    filters: JSON_FILTER,
  });
  return path ?? null;
}
