/** 检测当前是否运行在 Tauri 桌面环境中。 */
export const isTauriRuntime = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  const scope = window as unknown as Record<string, unknown>;
  return typeof scope.__TAURI_INTERNALS__ === 'object' && scope.__TAURI_INTERNALS__ !== null;
};
