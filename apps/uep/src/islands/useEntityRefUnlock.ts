/**
 * 嵌入 ref 解鎖判定 hook — 跨 entity 浮島聯集（S8 驗收 #2，前身
 * islands/concepts/useEntityUnlock 的 concepts-only 版）
 *
 * 為 decorateInteractiveHtml 提供條目級解鎖判定——「可點 ⟺ 相應浮島
 * 查得到內容」不變量的前端接線。原本只看 Concepts 島；改為聯集：
 * 同一 entityKey 可能同時綁 Concepts / Echoes / Visuals，**任一相應浮島
 * 已解鎖即可點**（艾斯維爾 2026-07-20 定案）。
 *
 * 行為：
 * - 各島各自掛載（探索者＋已解鎖＋未停用）才抓對應索引；未掛載的島
 *   不貢獻解鎖、也不浪費請求
 * - 索引未載入 / 失敗 → 該島分支一律不可點（安全預設：島此時也查不到
 *   內容，不變量仍成立）；載入完成觸發重繪
 * - Concepts 判定＝terminalCore.isEntityRefUnlocked（含舊格式路徑 ref 的
 *   met 旗標相容）；Echoes/Visuals 只處理新格式 entity-key ref，判定＝
 *   各自 zone 的 isSongUnlockedInZone / isGalleryUnlockedInZone
 */

import { useEffect, useMemo, useState } from 'react';

import { parseEntityRef } from '../embed/marks';
import type { ProgressState } from '../progress/types';

import {
  isEntityRefUnlocked,
  loadEntityIndex,
  type TerminalIndexEntry,
} from './concepts/terminalCore';
import {
  isEchoesEntityUnlocked,
  loadEchoesEntityIndex,
  type EchoesEntityIndexEntry,
} from './echoes/echoesEntityIndex';
import { shouldMountIsland } from './islandRuntime';
import {
  isVisualsEntityUnlocked,
  loadVisualsEntityIndex,
  type VisualsEntityIndexEntry,
} from './visuals/visualsEntityIndex';

/**
 * 回傳 ref → 是否可點 的聯集判定函式（progress / 各島索引變化時重建，
 * 呼叫端把它交給 renderInteractiveHtml / decorateInteractiveHtml）。
 */
export function useEntityRefUnlockChecker(
  progress: ProgressState
): (ref: string) => boolean {
  const conceptsMounted = shouldMountIsland(progress, 'concepts');
  const echoesMounted = shouldMountIsland(progress, 'echoes');
  const visualsMounted = shouldMountIsland(progress, 'visuals');

  const [conceptsIndex, setConceptsIndex] = useState<
    TerminalIndexEntry[] | null
  >(null);
  const [echoesIndex, setEchoesIndex] = useState<
    EchoesEntityIndexEntry[] | null
  >(null);
  const [visualsIndex, setVisualsIndex] = useState<
    VisualsEntityIndexEntry[] | null
  >(null);

  useEffect(() => {
    if (!conceptsMounted || conceptsIndex) return;
    let cancelled = false;
    void loadEntityIndex()
      .then((entries) => {
        if (!cancelled) setConceptsIndex(entries);
      })
      .catch(() => {
        /* 失敗維持 null——該分支保持不可點 */
      });
    return () => {
      cancelled = true;
    };
  }, [conceptsMounted, conceptsIndex]);

  useEffect(() => {
    if (!echoesMounted || echoesIndex) return;
    let cancelled = false;
    void loadEchoesEntityIndex()
      .then((entries) => {
        if (!cancelled) setEchoesIndex(entries);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [echoesMounted, echoesIndex]);

  useEffect(() => {
    if (!visualsMounted || visualsIndex) return;
    let cancelled = false;
    void loadVisualsEntityIndex()
      .then((entries) => {
        if (!cancelled) setVisualsIndex(entries);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visualsMounted, visualsIndex]);

  return useMemo(
    () => (ref: string) => {
      // Concepts 分支（含舊格式路徑 ref 的 met 旗標相容）
      if (isEntityRefUnlocked(conceptsIndex, ref, progress)) return true;
      // Echoes / Visuals 只認新格式 entity-key ref
      const parsed = parseEntityRef(ref);
      if (parsed.type !== 'entity-key') return false;
      const key = parsed.entityKey;
      return (
        isEchoesEntityUnlocked(echoesIndex, key, progress) ||
        isVisualsEntityUnlocked(visualsIndex, key, progress)
      );
    },
    [conceptsIndex, echoesIndex, visualsIndex, progress]
  );
}
