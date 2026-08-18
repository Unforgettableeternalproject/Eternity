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
import {
  loadConceptsIndex,
  loadConceptsPage,
  type ConceptsIndexEntry,
} from '../components/concepts/conceptsSource';
import { resolveFromData } from '../components/concepts/entityBinding';
import type { ZoneEntityIndexEntry } from '../lib/zoneEntityIndex';
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

  /**
   * 綁定求值用的 Concepts 資料（索引 + dossier 整頁）。
   *
   * **不能沿用 conceptsIndex**：那份只在 concepts 島掛載時才 fetch，沒掛載
   * 時恆為空陣列——孤兒判定會把所有 entity 誤判成孤兒，綁定求值則會誤判
   * 成「沒有 dossier 條目」。
   *
   * 只在真的需要時載入（Echoes／Visuals 任一掛載，或孤兒開關開啟）。
   * 走的是 `conceptsSource` 的共用快取，與 Terminal 島同一份——Terminal
   * 若已載過就是零請求。
   *
   * dossier **整頁**也要預載：綁定指向藏在條目的 `bindings` 與 revision
   * patch 裡，索引不帶（帶了等於公開未解鎖內容的 page id，即劇透）。
   * 正式站 dossier 合計 10 頁 9.3 KB。
   */
  const needBinding = echoesMounted || visualsMounted;
  const [dossierIndex, setDossierIndex] = useState<ConceptsIndexEntry[]>([]);
  const [dossierPages, setDossierPages] = useState<Map<string, unknown>>(
    () => new Map()
  );
  const [pagesPartial, setPagesPartial] = useState(false);
  // ⚠️ 就緒與否要有獨立旗標，**不可用 `dossierIndex.length === 0` 代替**：
  // 空索引是合法狀態（站上還沒有任何 Concepts 條目），那時所有 entity 都是
  // 孤兒，但「唯一候選」仍該讓它們可點
  const [dossierReady, setDossierReady] = useState(false);

  useEffect(() => {
    if (!needBinding && !orphanGateOn) return;
    let cancelled = false;
    void (async () => {
      const index = await loadConceptsIndex();
      if (cancelled) return;
      setDossierIndex(index);
      if (!needBinding) {
        setDossierReady(true);
        return;
      }
      const pageIds = Array.from(
        new Set(index.filter((e) => e.stack === 'dossier').map((e) => e.pageId))
      );
      const loaded = await Promise.all(
        pageIds.map(async (id) => [id, await loadConceptsPage(id)] as const)
      );
      if (cancelled) return;
      const pages = new Map<string, unknown>();
      let partial = false;
      for (const [id, data] of loaded) {
        if (data) pages.set(id, data);
        else partial = true;
      }
      setDossierPages(pages);
      setPagesPartial(partial);
      setDossierReady(true);
    })().catch(() => {
      // 靜默：資料拿不到時各分支維持不可點（安全預設）
    });
    return () => {
      cancelled = true;
    };
  }, [needBinding, orphanGateOn]);

  return useMemo(() => {
    /**
     * 這個 entityKey 在該 zone 此刻**指向的那一筆**是否已解鎖。
     *
     * 指向用與 IslandHost 完全相同的 `resolveFromData`；解鎖判定只餵被
     * 指向的那一筆進既有的 zone 判定函式——順帶接住「指向的內容
     * entityKey 對不上」（資料壞掉）的情況，與消費端同樣不顯示。
     */
    const isBoundAndUnlocked = (
      zone: 'echoes' | 'visuals',
      key: string,
      zoneEntries: ZoneEntityIndexEntry[] | null,
      isUnlocked: (
        entries: ZoneEntityIndexEntry[] | null,
        key: string,
        progress: ProgressState
      ) => boolean
    ): boolean => {
      // 資料未就緒 → 不可點（安全預設：浮島此時也查不到內容）
      if (!zoneEntries || !dossierReady) return false;
      const result = resolveFromData(
        {
          index: dossierIndex,
          pages: dossierPages,
          zoneEntries,
          partial: pagesPartial,
        },
        key,
        zone,
        progress
      );
      if (result.status !== 'bound') return false;
      return isUnlocked(
        zoneEntries.filter((e) => e.id === result.id),
        key,
        progress
      );
    };

    return (ref: string) => {
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
      // 🔑 可點判定必須與**點下去會發生什麼**一致（2026-08-18）。
      //
      // 一對多開放後，「同 key 有任一筆已解鎖」不再等於「浮島查得到
      // 內容」：同 key 多筆而 dossier 沒指明時求值回 unbound，浮島什麼
      // 都不顯示——嵌入卻仍是可點的，變成按了沒反應。
      //
      // 因此這裡走與 IslandHost 完全相同的 `resolveFromData`，再疊該
      // 內容自己的解鎖判定。資料是 Terminal 島本來就要載的那份（共用
      // 快取），不產生額外請求。
      return (
        (echoesMounted &&
          isBoundAndUnlocked(
            'echoes',
            key,
            echoesIndex,
            isEchoesEntityUnlocked
          )) ||
        (visualsMounted &&
          isBoundAndUnlocked(
            'visuals',
            key,
            visualsIndex,
            isVisualsEntityUnlocked
          ))
      );
    };
  }, [
    orphanGateOn,
    dossierIndex,
    dossierPages,
    pagesPartial,
    dossierReady,
    conceptsMounted,
    echoesMounted,
    visualsMounted,
    conceptsIndex,
    echoesIndex,
    visualsIndex,
    progress,
  ]);
}
