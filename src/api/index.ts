import { tauriBackend } from './client';
import type { Backend } from './contract';
import { mockBackend } from './mock';
import { isTauriRuntime } from './runtime';

export const isDesktop = isTauriRuntime();

/** 浏览器环境自动切换到 Mock 后端，保证界面可以独立预览与调试。 */
export const api: Backend = isDesktop ? tauriBackend : mockBackend;

export type { Backend } from './contract';
