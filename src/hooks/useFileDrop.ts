import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useEffect, useRef, useState } from 'react';

import { isDesktop } from '@/api';
import type { ProjectSource } from '@/types';

/**
 * 统一处理桌面端与浏览器端的文件拖拽。
 * 桌面端由 Tauri 提供真实路径，浏览器端读取文件内容后交给 Mock 后端。
 */
export function useFileDrop(
  onDrop: (source: ProjectSource) => void,
  enabled = true,
): boolean {
  const [active, setActive] = useState(false);
  const handlerRef = useRef(onDrop);

  useEffect(() => {
    handlerRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    if (!enabled) {
      setActive(false);
      return undefined;
    }

    if (isDesktop) {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === 'enter' || payload.type === 'over') {
            setActive(true);
            return;
          }
          if (payload.type === 'drop') {
            setActive(false);
            const path = payload.paths[0];
            if (path) {
              handlerRef.current({ path });
            }
            return;
          }
          setActive(false);
        })
        .then((dispose) => {
          if (disposed) {
            dispose();
          } else {
            unlisten = dispose;
          }
        });

      return () => {
        disposed = true;
        unlisten?.();
      };
    }

    const isFileDrag = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const handleDragEnter = (event: DragEvent) => {
      if (!isFileDrag(event)) {
        return;
      }
      event.preventDefault();
      setActive(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!isFileDrag(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      setActive(true);
    };

    const handleDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) {
        setActive(false);
      }
    };

    const handleDrop = async (event: DragEvent) => {
      event.preventDefault();
      setActive(false);
      const file = event.dataTransfer?.files?.[0];
      if (!file) {
        return;
      }
      if (!file.name.toLowerCase().endsWith('.json')) {
        handlerRef.current({ path: file.name });
        return;
      }
      try {
        const text = await file.text();
        handlerRef.current({ path: file.name, text });
      } catch {
        handlerRef.current({ path: file.name });
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [enabled]);

  return active;
}
