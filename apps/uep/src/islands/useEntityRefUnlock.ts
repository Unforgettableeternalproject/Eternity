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
import { useDesktopIslandViewport } from './useIslands';
import {
  isVisualsEntityUnlocked,
  loadVisualsEntityIndex,
  type VisualsEntityIndexEntry,
} from './visuals/visualsEntityIndex';
import { hasDossierEntry } from '../components/concepts/entityBinding';
import { getSetting } from '../lib/uepSettings';

/**
 * 回傳 ref → 是否可點 的聯集判定函式（progress / 各島索引變化時重建，
 * 呼叫端把它交給 renderInteractiveHtml / decorateInteractiveHtml）。
 */
export function useEntityRefUnlockChecker(
  progress: ProgressState
): (ref: string) => boolean {
  // resize／裝置旋轉即時重渲染（S8 手動驗收 #9 追加修復，同 IslandHost）
  const desktopViewport = useDesktopIslandViewport();
  const conceptsMounted =
    desktopViewport && shouldMountIsland(progress, 'concepts');
  const echoesMounted =
    desktopViewport && shouldMountIsland(progress, 'echoes');
  const visualsMounted =
    desktopViewport && shouldMountIsland(progress, 'visuals');

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

  // 開關一次性讀取（sessionStorage 同步值）——生效時機是「下一次頁面載入」，
  // 與其餘 uep_settings 消費點的既有契約一致
  const orphanGateOn =
    getSetting<string>('entityBinding.embedOrphanGate', 'disabled') ===
    'enabled';

  // 孤兒判定的索引**不能沿用 conceptsIndex**：那份只在 concepts 島掛載時
  // 才 fetch，沒掛載時恆為空陣列，開關一開就會把所有 entity 判成孤兒。
  // 只在開關開啟時載入，關閉時零額外請求。
  const [dossierIndex, setDossierIndex] = useState<TerminalIndexEntry[]>([]);
  useEffect(() => {
    if (!orphanGateOn) return;
    let cancelled = false;
    void loadEntityIndex()
      .then((entries) => {
        if (!cancelled) setDossierIndex(entries);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orphanGateOn]);

  return useMemo(
    () => (ref: string) => {
      // 各分支額外疊 Mounted 旗標：索引一旦 fetch 過會留在 state 裡，
      // 島之後才變成不可用（resize 到手機寬度／使用者停用／視角切換）
      // 時，若只靠 Mounted 控制要不要 fetch，舊索引仍會讓已抓過的 ref
      // 誤判可點——必須在判定當下也重驗 Mounted（S8 手動驗收 #9 追加
      // 修復，發現的既有問題，不只是 viewport 新增的缺口）。
      // Concepts 分支（含舊格式路徑 ref 的 met 旗標相容）
      if (conceptsMounted && isEntityRefUnlocked(conceptsIndex, ref, progress))
        return true;
      // Echoes / Visuals 只認新格式 entity-key ref
      const parsed = parseEntityRef(ref);
      if (parsed.type !== 'entity-key') return false;
      const key = parsed.entityKey;
      // 孤兒收緊（2026-08-15 定案，預設關閉）：沒有 dossier 條目的
      // entityKey 是佔位，跨區對應不成立。**這是唯一會拿掉現有功能的
      // 改動**——正式站目前 86% 的 Echoes entity 是孤兒，開關一翻它們
      // 的嵌入就從能點變成不能點，且沒有錯誤訊息。因此預設 disabled，
      // 何時翻開是內容決策（等 dossier 補齊或明確接受後果）。
      if (orphanGateOn && !hasDossierEntry(key, dossierIndex)) {
        return false;
      }
      return (
        (echoesMounted && isEchoesEntityUnlocked(echoesIndex, key, progress)) ||
        (visualsMounted && isVisualsEntityUnlocked(visualsIndex, key, progress))
      );
    },
    [
      orphanGateOn,
      dossierIndex,
      conceptsMounted,
      echoesMounted,
      visualsMounted,
      conceptsIndex,
      echoesIndex,
      visualsIndex,
      progress,
    ]
  );
}
