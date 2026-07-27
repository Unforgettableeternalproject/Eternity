/**
 * UEP 進度系統 — 掃描線核心（框架無關）
 *
 * 用 IntersectionObserver 觀察文章內的標記點（ProgressMarkerNode 等
 * 編輯器插入的功能性節點 + 文末哨兵），追蹤閱讀進度：
 *
 * - maxMarkerIdx：曾到達的最遠標記點（單調遞增，進度判定）
 * - lastMarkerIdx：最近通過的標記點（「回到上次位置」）
 * - totalMarkers = 內容標記點數（不含哨兵）；哨兵索引 = totalMarkers。
 *   通過哨兵 = 頁面完成，此時 max = last = totalMarkers（數字直覺對齊）
 *
 * 掃描線位置：
 * - 內容標記：視窗高度 80% 處（rootMargin bottom -20%）——
 *   標記點頂端越過該線即視為「通過」
 * - 文末哨兵：獨立 observer（rootMargin 0）——捲到底部哨兵一進入
 *   視窗即算完成（掃描線等效跟著捲到底）。否則文章尾端 trailing
 *   內容不夠高時，哨兵永遠過不了 80% 線，完成無法觸發
 *
 * 哨兵過線 = 整篇已讀：會補授「所有」內容標記的旗標——高速滾動時
 * IntersectionObserver 可能漏報中途標記，讀到文末時兜底補齊。
 *
 * React 端請用 useScanline（本模組的薄包裝）；
 * 非 React 的 Astro script 可直接 createScanline / destroy。
 */

import {
  computeElementRatio,
  isNonScrollable,
  isWithinFogReach,
} from './fogGate';
import { collectMarkers, completionFlag } from './markers';
import { getProgressManager } from './progressStore';

/** lastMarkerIdx 的寫入節流間隔（ms）——max 進度前進不受此限 */
const LAST_IDX_WRITE_DEBOUNCE = 800;

/** 標記點通過事件 */
export interface MarkerPassedInfo {
  /** 標記點索引（0-based；哨兵索引 = totalMarkers） */
  index: number;
  /**
   * 本次通過授予的旗標。哨兵事件會帶「所有」內容標記旗標的聯集
   * （兜底補授）；hr 與無旗標的手動標記為空陣列。
   */
  grantsFlags: string[];
  /** 是否為文末哨兵（= 頁面完成點） */
  isSentinel: boolean;
  /** 內容標記點總數（不含哨兵） */
  totalMarkers: number;
  /** 實際通過的 DOM 元素；哨兵事件為 sentinel。 */
  element: Element;
  /** 標記種類，額外消費端不必重新查 DOM 索引。 */
  role:
    | 'progress-marker'
    | 'echo-spot'
    | 'visual-clue-start'
    | 'visual-clue-gate'
    | 'visual-clue-end'
    | 'sentinel';
}

export interface ScanlineOptions {
  /** 目前頁面 id */
  pageId: string;
  /** 文章內容容器（收集標記點的範圍） */
  container: HTMLElement;
  /** 文末哨兵元素——渲染在文章結尾，通過即完成 */
  sentinel: HTMLElement;
  /** 滾動容器（IntersectionObserver root）；null 用 viewport */
  root?: HTMLElement | null;
  /** 標記點通過時的回呼（額外消費端用；授予/完成已內建） */
  onMarkerPassed?: (info: MarkerPassedInfo) => void;
  /**
   * 這一頁是否適用迷霧（S10-2）。由呼叫端判定並傳入——「算不算進度頁」
   * 是 tree 語意，掃描線不該自己重算一份。預設 false（不設限）。
   */
  fogApplies?: boolean;
}

export interface ScanlineHandle {
  /** 停止觀察並 flush 未寫入的進度 */
  destroy(): void;
}

/**
 * 建立掃描線。內容重渲染後必須 destroy 舊實例並重建
 * （observer 綁的是建立當下的 DOM 快照）。
 */
export function createScanline(options: ScanlineOptions): ScanlineHandle {
  const {
    pageId,
    container,
    sentinel,
    root = null,
    onMarkerPassed,
    fogApplies = false,
  } = options;

  if (typeof IntersectionObserver === 'undefined') {
    return { destroy() {} };
  }

  const store = getProgressManager();
  const markers = collectMarkers(container);
  /**
   * 迷霧是否介入這一頁（S10-2）。四個關閉條件：
   * - 呼叫端說這頁不適用（非進度頁且無解鎖條件——遮住一篇不解鎖任何
   *   東西也不在進度鏈上的文章，只是徒增閱讀阻力）
   * - 已完成過 → 重讀不再限制（用 completedPageIds 而非
   *   `isEffectivelyCompleted`：後者會因為無關的依賴鏈變化把「讀過」
   *   變回「沒讀過」，讀者無從理解也無法自行解除）
   * - 內容短到不需要捲動 → 見 fogGate.isNonScrollable 的死鎖說明
   * - 沒有捲動容器 → 位置換算失去共同座標系，寧可不擋
   */
  const fogEnabled =
    fogApplies &&
    !store.getState().completedPageIds.includes(pageId) &&
    !!root &&
    !isNonScrollable(root.scrollHeight, root.clientHeight);

  /**
   * 位置閘門：這個標記在不在迷霧線的可及範圍內。
   *
   * ⚠️ 純判定，**不推進迷霧線**。推進的唯一入口是呼叫端的捲動取樣
   * （HistoryReader.sampleFog），因為那裡才有時間軸可以套速率上限。
   * 若這裡也推進，標記通過就等於免費跳過速率限制。
   */
  const passesFogGate = (el: Element): boolean => {
    if (!fogEnabled || !root) return true;
    const ratio = computeElementRatio(el, root);
    const stored = store.getState().fogRatio[pageId] ?? 0;
    return isWithinFogReach(
      ratio,
      stored,
      root.clientHeight,
      root.scrollHeight
    );
  };
  // totalMarkers = 內容標記數；哨兵索引 = totalMarkers（完成時 max = total）
  const totalMarkers = markers.length;
  const sentinelIdx = totalMarkers;

  const indexOf = new Map<Element, number>(markers.map((m) => [m.el, m.index]));

  // 以既有進度為基準（跨 session 續讀時不倒退）
  let maxIdx = store.getState().pageMarkers[pageId]?.maxMarkerIdx ?? -1;
  let lastIdx = -1;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  const write = () => {
    writeTimer = null;
    store.updatePageMarker(
      pageId,
      Math.max(maxIdx, 0),
      Math.max(lastIdx, 0),
      totalMarkers
    );
  };

  const scheduleWrite = (immediate: boolean) => {
    if (immediate) {
      if (writeTimer) clearTimeout(writeTimer);
      write();
      return;
    }
    if (writeTimer) return;
    writeTimer = setTimeout(write, LAST_IDX_WRITE_DEBOUNCE);
  };

  /** 哨兵通過：整篇已讀——完成 + 補授所有內容標記的旗標 */
  const passSentinel = () => {
    // 哨兵是「跳到底」最容易命中的目標（文章最後面的 1px 空 div），
    // 單靠「進入視窗」擋不住任何形式的跳躍，而下面那段兜底補授會把
    // 整頁旗標一次發完——這是 rush prevention 最大的後門。
    // 迷霧線推到 1 只可能靠連續推進達成，用它當第二個條件。
    if (fogEnabled && (store.getState().fogRatio[pageId] ?? 0) < 1) return;
    lastIdx = sentinelIdx;
    maxIdx = Math.max(maxIdx, sentinelIdx);

    // 兜底補授：高速滾動可能漏報中途 FlagMarker，讀完時補齊
    const allFlags = [...new Set(markers.flatMap((m) => m.grantsFlags))];
    if (allFlags.length > 0) {
      store.grantFlags(allFlags);
    }

    // 完成狀態同時以 completed:* 旗標暴露，讓 gating 統一用旗標消費
    store.markPageCompleted(pageId);
    store.grantFlags([completionFlag(pageId)]);
    scheduleWrite(true);

    onMarkerPassed?.({
      index: sentinelIdx,
      grantsFlags: allFlags,
      isSentinel: true,
      totalMarkers,
      element: sentinel,
      role: 'sentinel',
    });
  };

  // 內容標記 observer：掃描線在視窗高度 80% 處
  const markerObserver = new IntersectionObserver(
    (entries) => {
      let maxAdvanced = false;
      let anyPassed = false;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const idx = indexOf.get(entry.target);
        if (idx === undefined) continue;
        // 迷霧線以下的標記當作不存在：不寫進度、不授旗、不發事件。
        // 閘門設在這裡而不是各消費端，消費端才能維持「收到事件＝可以
        // 安心處理」的心智模型——useEchoSpots 一收到事件就把 spotId
        // 記進去重集合，若讓事件發出去再擋，rush 經過的回聲點會被記成
        // 已觸發，迷霧推進後就永遠不再響。
        if (!passesFogGate(entry.target)) continue;

        anyPassed = true;
        lastIdx = idx;
        if (idx > maxIdx) {
          maxIdx = idx;
          maxAdvanced = true;
        }

        // FlagMarker 位置粒度授予：掃描線通過標註點才給旗標
        // （「出現名字 ≠ 認識人物」——授予點由編輯器手動標註）
        const grantsFlags = markers[idx].grantsFlags;
        if (grantsFlags.length > 0) {
          store.grantFlags(grantsFlags);
        }

        onMarkerPassed?.({
          index: idx,
          grantsFlags,
          isSentinel: false,
          totalMarkers,
          element: markers[idx].el,
          role: markers[idx].role,
        });
      }
      // max 進度前進立即寫入；單純位置變更節流寫入
      if (anyPassed) scheduleWrite(maxAdvanced);
    },
    {
      root,
      // 掃描線在視窗高度 80% 處
      rootMargin: '0px 0px -20% 0px',
      threshold: 0,
    }
  );

  // 哨兵 observer：不縮視窗——捲到底部哨兵進入視窗即完成
  let sentinelVisible = false;
  const sentinelObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) sentinelVisible = entry.isIntersecting;
      if (sentinelVisible) passSentinel();
    },
    { root, threshold: 0 }
  );

  /**
   * 迷霧推到底時補一次完成判定。
   *
   * 捲到底的那一瞬間，哨兵的 IO 回呼與迷霧取樣（rAF）誰先誰後不保證。
   * 若哨兵先跑，當下 fogRatio 還不是 1 會被 §6 的合取擋下，而 IO 只在
   * 交集狀態**變化**時回呼——讀者停在底部不動就再也等不到第二次事件，
   * 明明讀完了卻卡著不完成。
   */
  const unsubscribeFog = fogEnabled
    ? store.subscribe((_state, detail) => {
        if (detail.source !== 'fog-advance' || !sentinelVisible) return;
        passSentinel();
      })
    : null;

  markers.forEach((m) => markerObserver.observe(m.el));
  sentinelObserver.observe(sentinel);

  return {
    destroy() {
      markerObserver.disconnect();
      sentinelObserver.disconnect();
      unsubscribeFog?.();
      // 離頁前 flush 未寫入的位置，避免掉最後的閱讀進度
      if (writeTimer) {
        clearTimeout(writeTimer);
        if (lastIdx >= 0) write();
      }
    },
  };
}
