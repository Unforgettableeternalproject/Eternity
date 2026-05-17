import { useEffect, useRef, type RefObject } from 'react';

/**
 * 跨視圖滾動位置記憶 hook
 *
 * 用法：
 *   const { saveScroll, restoreScroll } = useScrollMemory(scrollRef, [view, id]);
 *   // 導航前：saveScroll('landing');
 *   // 導航後：restoreScroll('division:abc');
 */
export function useScrollMemory(
  scrollRef: RefObject<HTMLDivElement | null>,
  deps: unknown[],
) {
  const memory = useRef<Map<string, number>>(new Map());
  const pendingKey = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingKey.current) return;
    const key = pendingKey.current;
    pendingKey.current = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const saved = memory.current.get(key);
        if (saved != null && saved > 0) {
          scrollRef.current?.scrollTo({ top: saved });
        } else {
          scrollRef.current?.scrollTo({ top: 0 });
        }
      });
    });
  }, deps); // deps 由呼叫端控制

  function saveScroll(key: string) {
    if (scrollRef.current) {
      memory.current.set(key, scrollRef.current.scrollTop);
    }
  }

  function restoreScroll(key: string) {
    pendingKey.current = key;
  }

  return { saveScroll, restoreScroll };
}
