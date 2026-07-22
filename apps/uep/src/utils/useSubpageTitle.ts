/**
 * useSubpageTitle — 三 Reader 共用的 document.title 子頁更新（S9-A Codex #5）
 *
 * 問題：便條 pool 顯示「釘在 XXX」讀的是 PinnedNote.pageLabel，pageLabel 於
 * `commitPin` 當下拍下 `document.title` 快照。原本各 zone 的 astro layout 只
 * 提供 zone 級 title（「回音蒐藏間 - 邊際世界」），Reader 換子頁時完全不更新
 * `document.title`——結果所有釘選的 pageLabel 都是同一個 zone title，pool
 * 「釘在 XXX」和瀏覽器分頁標題全部指不出實際文章。
 *
 * 修法：三 Reader 於載入子頁時透過此 hook 更新 title 為
 *   `{subject} - {baseTitle}`
 * unmount 或 subject 為 null 時還原成 baseTitle。
 *
 * baseTitle 由 hook 於首次執行時鎖定（避免自己更新造成累加）。
 */

import { useEffect, useRef } from 'react';

/**
 * @param subject 子頁標題；`null` 或空字串代表未進子頁 → 還原 baseTitle
 * @param separator 預設 ` - `，與 astro layout 的 zone title 格式一致
 */
export function useSubpageTitle(
  subject: string | null | undefined,
  separator = ' - '
): void {
  const baseTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (baseTitleRef.current === null) {
      baseTitleRef.current = document.title;
    }
    const base = baseTitleRef.current;
    const next =
      subject && subject.trim() ? `${subject}${separator}${base}` : base;
    if (document.title !== next) {
      document.title = next;
    }
  }, [subject, separator]);

  // 元件 unmount 時還原 base（避免離開 Reader 後 title 卡在子頁）
  useEffect(() => {
    return () => {
      if (typeof document === 'undefined') return;
      if (baseTitleRef.current !== null) {
        document.title = baseTitleRef.current;
      }
    };
  }, []);
}
