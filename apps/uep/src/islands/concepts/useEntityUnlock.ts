/**
 * 嵌入 ref 解鎖判定 hook（2026-07-17）
 *
 * 為 decorateInteractiveHtml 提供條目級解鎖判定——「可點 ⟺ terminal
 * 查得到內容」不變量的前端接線。放在 islands/concepts（而非 embed）
 * 以維持 embed → islands 的單向依賴：judgement 由 Reader 注入 callback。
 *
 * 行為：
 * - concepts 島掛載（探索者＋已解鎖＋未停用）才抓索引；未掛載時
 *   decorate 本來就整體不啟用，不浪費請求
 * - 索引未載入 / 載入失敗 → entity-key 嵌入一律不可點（安全預設：
 *   terminal 此時也查不到內容，不變量仍成立）；載入完成觸發重繪
 * - 判定本體 = terminalCore.isEntityRefUnlocked（與 query/ls 的
 *   隱藏過濾同一套 isIndexEntryUnlocked 語意）
 */

import { useEffect, useMemo, useState } from 'react';

import type { ProgressState } from '../../progress/types';
import { shouldMountIsland } from '../islandRuntime';

import { isEntityRefUnlocked, loadEntityIndex } from './terminalCore';
import type { TerminalIndexEntry } from './terminalCore';

/**
 * 回傳 ref → 是否可點 的判定函式（progress / 索引變化時重建，
 * 呼叫端把它交給 renderInteractiveHtml / decorateInteractiveHtml）。
 */
export function useEntityRefUnlockChecker(
  progress: ProgressState
): (ref: string) => boolean {
  const mounted = shouldMountIsland(progress, 'concepts');
  const [index, setIndex] = useState<TerminalIndexEntry[] | null>(null);

  useEffect(() => {
    if (!mounted || index) return;
    let cancelled = false;
    void loadEntityIndex()
      .then((entries) => {
        if (!cancelled) setIndex(entries);
      })
      .catch(() => {
        /* 失敗維持 null——entity-key 嵌入保持不可點（terminal 同樣查不到） */
      });
    return () => {
      cancelled = true;
    };
  }, [mounted, index]);

  return useMemo(
    () => (ref: string) => isEntityRefUnlocked(index, ref, progress),
    [index, progress]
  );
}
