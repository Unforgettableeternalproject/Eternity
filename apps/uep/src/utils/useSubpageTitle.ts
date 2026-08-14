/**
 * useSubpageTitle — 三 Reader 共用的子頁位置發佈（S9-A Codex #5 → 07/24 擴充）
 *
 * 職責有二（單一呼叫點同時餵兩張嘴）：
 *  1. 發佈 pageContext（路由級真相）——島 header 位置條與釘選 pageLabel
 *     的資料來源。**這才是主要輸出**；document.title 只是副產品。
 *  2. 更新 `document.title` 為 `{subject} - {baseTitle}`——瀏覽器分頁標題。
 *
 * unmount 或 subject 為 null 時還原 baseTitle 並清空 pageContext。
 * baseTitle 由 hook 於首次執行時鎖定（避免自己更新造成累加）。
 */

import { useEffect, useRef } from 'react';

import { clearPageContext, setPageContext } from './pageContext';

export interface UseSubpageTitleOptions {
  /** title 串接分隔，預設 ` - `，與 astro layout 的 zone title 格式一致 */
  separator?: string;
  /** 祖先鏈標題（如 history 的 chapter/arc），發佈進 pageContext */
  trail?: string[];
}

/**
 * @param subject 子頁標題；`null` 或空字串代表未進子頁 → 還原 baseTitle
 */
export function useSubpageTitle(
  subject: string | null | undefined,
  options: UseSubpageTitleOptions = {}
): void {
  const { separator = ' - ', trail } = options;
  const baseTitleRef = useRef<string | null>(null);
  // trail 是呼叫端 render 期間現組的陣列，直接進 deps 會每次都觸發——
  // 序列化後比對內容
  const trailKey = JSON.stringify(trail ?? []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (baseTitleRef.current === null) {
      baseTitleRef.current = document.title;
    }
    const base = baseTitleRef.current;
    const trimmed = subject && subject.trim() ? subject.trim() : null;
    const next = trimmed ? `${trimmed}${separator}${base}` : base;
    if (document.title !== next) {
      document.title = next;
    }
    setPageContext(trimmed, JSON.parse(trailKey) as string[]);
  }, [subject, separator, trailKey]);

  // 元件 unmount 時還原 base + 清 pageContext（避免離開 Reader 後殘留）
  useEffect(() => {
    return () => {
      if (typeof document === 'undefined') return;
      if (baseTitleRef.current !== null) {
        document.title = baseTitleRef.current;
      }
      clearPageContext();
    };
  }, []);
}
