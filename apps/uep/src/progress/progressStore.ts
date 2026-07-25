/**
 * UEP 進度系統 — 中央 Store（module singleton + window bridge）
 *
 * 跨 React island 共享模式沿用 UepToast/UepDialog 的做法：
 * module-level state + `window.__uepProgress` bridge + subscribe/notify。
 * 另外在每次變更時 dispatch `uep:progress-change` CustomEvent，
 * 讓非 React 的 Astro script 也能監聽。
 *
 * 所有 mutation 一律走此 store，禁止各元件自行讀寫 localStorage。
 */

import { LocalStorageAdapter } from './adapters';
import { COMPLETION_FLAG_PREFIX, isEffectivelyCompleted } from './gating';
import type { ProgressTreeAdapter } from './tree';
import type {
  ProgressAdapter,
  ProgressState,
  StorageNote,
  ViewMode,
} from './types';
import {
  STORAGE_NOTE_MAX,
  STORAGE_NOTE_TEXT_MAX,
  createInitialState,
} from './types';

/** 進度變更事件名稱（CustomEvent<ProgressChangeDetail>） */
export const PROGRESS_CHANGE_EVENT = 'uep:progress-change';

/** 進度變更事件的 detail 內容 */
export interface ProgressChangeDetail {
  state: ProgressState;
  /** 本次變更的來源操作，方便消費端過濾 */
  source:
    | 'init'
    | 'view-change'
    | 'flags-granted'
    | 'flags-revoked'
    | 'page-completed'
    | 'island-unlocked'
    | 'island-relocked'
    | 'island-setting'
    | 'marker-update'
    | 'page-visited'
    | 'lost-bookmark'
    | 'reading-time'
    | 'concepts-read-level'
    | 'storage-note'
    | 'hydrate'
    | 'reset'
    | 'sweep';
}

type Listener = (state: ProgressState, detail: ProgressChangeDetail) => void;

declare global {
  interface Window {
    __uepProgress?: typeof uepProgress;
  }
}

/* ── module-level 狀態 ── */
let adapter: ProgressAdapter = new LocalStorageAdapter();
let state: ProgressState = bootstrap();
const listeners: Listener[] = [];

/**
 * adapter 世代編號——每次 `setAdapter()` 遞增。
 *
 * 非同步 hydrate 期間 adapter 可能又被換掉（最常見：載入途中使用者登出，
 * logout 會把 adapter 切回 LocalStorageAdapter 並 reset）。少了這道檢查，
 * 稍後回來的舊帳號遠端快照會覆蓋剛清空的 state，`persist()` 還會透過
 * **新的** adapter 把上一個帳號的資料寫回本機——重置形同無效。
 */
let adapterGeneration = 0;

/** 便條 id 遞增序號（module 生命週期內單調，配時間戳前綴保證跨 session 唯一） */
let storageNoteSeq = 0;
/** 便條傾斜角輪替值——不用亂數以利 SSR/測試可預期，視覺上仍夠散 */
const STORAGE_NOTE_TILTS = [-1.6, 1.2, -0.6, 1.8, -1.1, 0.7];

/** 建立一張新便條（id/tilt/時間戳一次算好） */
function makeStorageNote(text: string): StorageNote {
  const now = new Date().toISOString();
  const seq = storageNoteSeq++;
  return {
    id: `note-${Date.now().toString(36)}-${seq.toString(36)}`,
    text,
    tilt: STORAGE_NOTE_TILTS[seq % STORAGE_NOTE_TILTS.length],
    createdAt: now,
    updatedAt: now,
  };
}

/** 初始化：同步從 localStorage 讀取，避免 first paint 閃爍 */
function bootstrap(): ProgressState {
  if (typeof window === 'undefined') return createInitialState();
  const local = new LocalStorageAdapter().loadSync();
  return local ?? createInitialState();
}

function persist(): void {
  void adapter.save(state);
}

function notify(source: ProgressChangeDetail['source']): void {
  const detail: ProgressChangeDetail = { state, source };
  listeners.forEach((fn) => fn(state, detail));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<ProgressChangeDetail>(PROGRESS_CHANGE_EVENT, { detail })
    );
  }
}

/** 取 `remote ∪ (local \ base)`——把空窗期新增的項目疊回遠端快照，保序去重 */
function unionAdded(
  remote: string[],
  base: string[],
  local: string[]
): string[] {
  const baseSet = new Set(base);
  const merged = [...remote];
  const seen = new Set(remote);
  for (const item of local) {
    if (baseSet.has(item) || seen.has(item)) continue;
    merged.push(item);
    seen.add(item);
  }
  return merged;
}

/**
 * hydrate 競態的收斂規則（2026-07-26）
 *
 * `setAdapter()` 的 `await load()` 是一段空窗期，而 UI 並沒有停下來——
 * ReaderShell mount、讀完一頁、完成解鎖儀式都可能在這期間寫入 state。
 * 舊實作直接 `state = remote`，這些寫入全部蒸發，而且因為多數是
 * mount effect 寫的、hydrate 不會讓 effect 重跑，**這一輪就永遠回不來**。
 *
 * 收斂策略：**單調增長的授予集合取聯集**，其餘欄位以遠端為準。
 * 理由是兩類欄位的失效代價不對稱——授予集合掉了會讓 UI 功能整片消失
 * （解鎖儀式叫不出來、已解鎖的島原地上鎖），而 marker 位置、閱讀時數
 * 這種連續量被遠端快照覆蓋只是輕微回退，下一次 mutation 就自我修正。
 *
 * ⚠️ 已知取捨：空窗期內的 `revokeFlags()` 會被聯集復活。目前 revoke 的
 * 唯一生產呼叫端是 DevTools 測試 bridge，可接受；若未來出現真實的
 * 「旗標會失效」機制，這裡要改成帶時間戳的 tombstone。
 */
function mergeHydrated(
  remote: ProgressState,
  base: ProgressState,
  local: ProgressState
): ProgressState {
  return {
    ...remote,
    flags: unionAdded(remote.flags, base.flags, local.flags),
    completedPageIds: unionAdded(
      remote.completedPageIds,
      base.completedPageIds,
      local.completedPageIds
    ),
    islandsUnlocked: unionAdded(
      remote.islandsUnlocked,
      base.islandsUnlocked,
      local.islandsUnlocked
    ),
    // 觀測者印記是永久標記，任一邊落下就算數
    observerEver: remote.observerEver || local.observerEver,
    updatedAt: new Date().toISOString(),
  };
}

function mutate(
  source: ProgressChangeDetail['source'],
  updater: (prev: ProgressState) => ProgressState
): void {
  state = { ...updater(state), updatedAt: new Date().toISOString() };
  persist();
  notify(source);
}

/* ── 公開 API ── */
export const uepProgress = {
  /** 取得目前狀態（唯讀快照，勿直接修改） */
  getState(): ProgressState {
    return state;
  },

  /**
   * 切換視角。切換至 observer 時同步寫入永久印記 observerEver。
   * 注意：劇透警告的確認流程由 UI 層負責（ViewSwitch），store 不做攔截。
   */
  setView(view: ViewMode): void {
    if (view === state.view) return;
    mutate('view-change', (prev) => ({
      ...prev,
      view,
      observerEver: prev.observerEver || view === 'observer',
    }));
  },

  /** 授予旗標（重複授予自動去重） */
  grantFlags(flags: string[]): void {
    const next = flags.filter((f) => !state.flags.includes(f));
    if (next.length === 0) return;
    mutate('flags-granted', (prev) => ({
      ...prev,
      flags: [...prev.flags, ...next],
    }));
  },

  /** 是否持有旗標 */
  hasFlag(flag: string): boolean {
    return state.flags.includes(flag);
  },

  /**
   * 撤銷旗標（S6-3）。目前消費端是 dev 測試 bridge；語意保持通用，
   * 未來若有「旗標會失效」的機制可直接沿用。不存在的旗標忽略。
   */
  revokeFlags(flags: string[]): void {
    const drop = new Set(flags);
    if (!state.flags.some((f) => drop.has(f))) return;
    mutate('flags-revoked', (prev) => ({
      ...prev,
      flags: prev.flags.filter((f) => !drop.has(f)),
    }));
  },

  /**
   * 記錄最後造訪的 History 頁面（S6-2，換頁副作用呼叫）。
   * 與掃描線 pageMarkers 無關——沒捲動過任何標記點也算造訪，
   * 續讀顯示（旅程之書）以此為優先來源。
   */
  markPageVisited(pageId: string): void {
    if (!pageId) return;
    mutate('page-visited', (prev) => ({
      ...prev,
      lastVisitedPageId: pageId,
      lastVisitedAt: new Date().toISOString(),
    }));
  },

  /**
   * 更新「遺落的書籤」機率狀態（S6-2）。
   * roll / 遞增 / 忽視重置的規則在 islands/history/lostBookmark.ts，
   * store 只負責存值。
   */
  updateLostBookmark(patch: { chancePct?: number; visible?: boolean }): void {
    mutate('lost-bookmark', (prev) => ({
      ...prev,
      lostBookmark: {
        chancePct: Math.min(
          100,
          Math.max(0, patch.chancePct ?? prev.lostBookmark.chancePct)
        ),
        visible: patch.visible ?? prev.lostBookmark.visible,
      },
    }));
  },

  /** 標記 History 頁面為已完成 */
  markPageCompleted(pageId: string): void {
    if (state.completedPageIds.includes(pageId)) return;
    mutate('page-completed', (prev) => ({
      ...prev,
      completedPageIds: [...prev.completedPageIds, pageId],
    }));
  },

  /**
   * 孤兒 complete 靜默清理。
   *
   * 掃過所有 `completed:*` 旗標，用 isEffectivelyCompleted 遞迴驗證每個
   * 是否合法（含依賴鏈）；不合法者一律剔除。靜默執行，回傳被清除的旗標
   * 陣列供 debug/測試用（實際使用可忽略回傳值）。
   *
   * 典型情境：測試模式手動蓋 completed:1-4，但 1-1~1-3 沒完成 →
   * 該 flag 為孤兒、下游 1-5 卻因此洩漏可讀，這裡把 1-4 flag 清掉，
   * 求值邏輯就會把 1-5 回歸鎖定。
   *
   * @param tree tree adapter；tree 中不存在的頁面保守保留（可能是 tree
   *             未完全載入或該頁在他 area）
   * @returns 被清除的 completed:* 旗標陣列（可能為空）
   */
  sweepOrphanCompletions(tree: ProgressTreeAdapter): string[] {
    const orphaned: string[] = [];
    for (const flag of state.flags) {
      if (!flag.startsWith(COMPLETION_FLAG_PREFIX)) continue;
      const pageId = flag.slice(COMPLETION_FLAG_PREFIX.length);
      if (!tree.getNode(pageId)) continue; // 保守：未識別的頁面不動
      if (!isEffectivelyCompleted(pageId, state, tree)) {
        orphaned.push(flag);
      }
    }
    if (orphaned.length === 0) return [];
    const drop = new Set(orphaned);
    mutate('sweep', (prev) => ({
      ...prev,
      flags: prev.flags.filter((f) => !drop.has(f)),
    }));
    return orphaned;
  },

  /** 解鎖浮島 */
  unlockIsland(islandId: string): void {
    if (state.islandsUnlocked.includes(islandId)) return;
    mutate('island-unlocked', (prev) => ({
      ...prev,
      islandsUnlocked: [...prev.islandsUnlocked, islandId],
    }));
  },

  /**
   * 重新上鎖浮島（S6-3）。dev 測試 bridge 用——回到「未解鎖」狀態以便
   * 重驗解鎖儀式。視窗會因 IslandHost 的守門條件自動卸載，不需另行 close。
   */
  relockIsland(islandId: string): void {
    if (!state.islandsUnlocked.includes(islandId)) return;
    mutate('island-relocked', (prev) => ({
      ...prev,
      islandsUnlocked: prev.islandsUnlocked.filter((id) => id !== islandId),
    }));
  },

  /**
   * 更新 Terminal 已讀水位（S7-C 更動通知，TerminalIsland 呼叫）。
   * 水位單調不降：僅接受高於現值的數字——旗標撤銷（dev bridge）造成的
   * 回退不降水位，避免同一批 revision 重新解鎖時重複通知。
   */
  updateConceptsReadLevel(levels: Record<string, number>): void {
    const patch: Record<string, number> = {};
    for (const [key, value] of Object.entries(levels)) {
      if (!Number.isFinite(value) || value < 0) continue;
      if ((state.conceptsReadLevel[key] ?? -1) < value) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) return;
    mutate('concepts-read-level', (prev) => ({
      ...prev,
      conceptsReadLevel: { ...prev.conceptsReadLevel, ...patch },
    }));
  },

  /**
   * 累計閱讀時間（S6，HistoryReader 每次頁面停留結束時呼叫）。
   * 呼叫端負責上限防灌水（單次造訪 cap），這裡只做累加與防禦。
   */
  addReadingTime(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    mutate('reading-time', (prev) => ({
      ...prev,
      readingStats: { totalMs: prev.readingStats.totalMs + ms },
    }));
  },

  /**
   * 新增便條（S9 便條島）。text 前後空白 trim、截斷 STORAGE_NOTE_TEXT_MAX 字；
   * trim 後為空則忽略。達 STORAGE_NOTE_MAX 上限時不新增，回傳 false 供呼叫端提示。
   */
  addStorageNote(text: string): boolean {
    const clean = text.trim().slice(0, STORAGE_NOTE_TEXT_MAX);
    if (!clean) return false;
    if (state.storageNotes.length >= STORAGE_NOTE_MAX) return false;
    const note = makeStorageNote(clean);
    mutate('storage-note', (prev) => ({
      ...prev,
      storageNotes: [...prev.storageNotes, note],
    }));
    return true;
  },

  /**
   * 編輯便條文字（S9）。trim + 截斷；trim 後為空則忽略（要清空請改用刪除）。
   * 更新該便條的 updatedAt（便條列表據此重排至最上）；內容未變或找不到 id 忽略。
   */
  updateStorageNote(id: string, text: string): void {
    const clean = text.trim().slice(0, STORAGE_NOTE_TEXT_MAX);
    if (!clean) return;
    const target = state.storageNotes.find((n) => n.id === id);
    if (!target || target.text === clean) return;
    const now = new Date().toISOString();
    mutate('storage-note', (prev) => ({
      ...prev,
      storageNotes: prev.storageNotes.map((n) =>
        n.id === id ? { ...n, text: clean, updatedAt: now } : n
      ),
    }));
  },

  /**
   * 刪除便條（S9）。釘選態的連帶清理由 pinnedStore 監聽 progress-change
   * 自動處理（解耦，progressStore 不 import islands 層）。找不到 id 忽略。
   */
  removeStorageNote(id: string): void {
    if (!state.storageNotes.some((n) => n.id === id)) return;
    mutate('storage-note', (prev) => ({
      ...prev,
      storageNotes: prev.storageNotes.filter((n) => n.id !== id),
    }));
  },

  /**
   * 設定浮島的使用者停用狀態（S6 設定視窗呼叫）。
   * 停用與解鎖分開存：停用 ≠ 未解鎖，重新啟用不需要再解鎖。
   */
  setIslandDisabled(islandId: string, disabled: boolean): void {
    const has = state.islandsDisabled.includes(islandId);
    if (disabled === has) return;
    mutate('island-setting', (prev) => ({
      ...prev,
      islandsDisabled: disabled
        ? [...prev.islandsDisabled, islandId]
        : prev.islandsDisabled.filter((id) => id !== islandId),
    }));
  },

  /** 更新頁面掃描線進度（S2 掃描線系統呼叫） */
  updatePageMarker(
    pageId: string,
    maxMarkerIdx: number,
    lastMarkerIdx: number,
    totalMarkers: number
  ): void {
    const prev = state.pageMarkers[pageId];
    const nextMax = Math.max(prev?.maxMarkerIdx ?? 0, maxMarkerIdx);
    if (
      prev &&
      prev.maxMarkerIdx === nextMax &&
      prev.lastMarkerIdx === lastMarkerIdx
    )
      return;
    mutate('marker-update', (p) => ({
      ...p,
      pageMarkers: {
        ...p.pageMarkers,
        [pageId]: {
          maxMarkerIdx: nextMax,
          lastMarkerIdx,
          totalMarkers,
          updatedAt: new Date().toISOString(),
        },
      },
    }));
  },

  /**
   * 替換儲存 adapter（S5 登入後切換 ServerAdapter）。
   * adapter.load() 有資料時以其為準覆蓋本地狀態（伺服器優先策略）。
   *
   * ⚠️ hydrate 期間發生的本地 mutation 不會被丟棄——見 `mergeHydrated()`。
   *
   * ⚠️ hydrate 期間若 adapter 又被換掉（最常見：載入途中使用者登出），
   * 這次的遠端結果一律丟棄——見 `adapterGeneration`。
   *
   * @param options.hydrate 傳 false 則只換 adapter、不讀遠端。登出時用：
   *   下一步就要 `reset()`，讀回上一個帳號的鏡像純粹是浪費與畫面閃爍。
   */
  async setAdapter(
    next: ProgressAdapter,
    options?: { hydrate?: boolean }
  ): Promise<void> {
    adapter = next;
    const generation = ++adapterGeneration;
    if (options?.hydrate === false) return;

    const base = state;
    const remote = await next.load();
    if (generation !== adapterGeneration) return; // 已被更替，結果作廢

    if (!remote) {
      // 遠端無資料：把本地進度上傳作為初始值
      persist();
      return;
    }
    if (state === base) {
      // 空窗期沒有任何 mutation：伺服器優先，直接採用
      state = remote;
      notify('hydrate');
      return;
    }
    // 空窗期有人寫入過：把新增的授予疊回遠端快照，並回寫以免只存在記憶體
    state = mergeHydrated(remote, base, state);
    persist();
    notify('hydrate');
  },

  /**
   * 伺服器權威 hydrate：遠端為準，遠端空則歸零，**絕不把本地推上去**。
   *
   * 用於「伺服器端的資料已被第三方改寫」的情境（目前是 admin 在後台編輯
   * 或重置了這個帳號的進度，讀者端 PUT 收到 409）。
   *
   * 與 `setAdapter()` 的兩點關鍵差異，都是為了避免把 admin 的操作蓋掉：
   * 1. 遠端為 null 時**不上傳本地**（setAdapter 會，那是「新帳號初始化」
   *    語意）。admin 清空後上傳本地等於原地復原他的重置。
   * 2. 不做 mergeHydrated 聯集——admin 的版本就是唯一事實，本地那份
   *    正是被判定為過期的東西。
   *
   * 刻意不呼叫 `persist()`：這份資料剛從伺服器來，推回去只會再撞一次
   * 版本檢查而陷入 409 循環。只同步本地鏡像；等使用者真的有新動作時，
   * 那次 mutation 自然會帶著新版本號上傳。
   *
   * 三個必要條件，缺一就會把 admin 的操作蓋掉或洩漏內容：
   * 1. 走 `loadAuthoritative()` 而非 `load()`——後者在 GET 失敗時會
   *    fallback 本地鏡像，而那正是被判定過期的資料。
   * 2. 讀不到就**保持現狀**（不歸零）。歸零會讓使用者平白失去進度顯示，
   *    且下次 mutation 會把空狀態寫回伺服器。
   * 3. `observerEver` 取伺服器欄位而非 blob——admin 清空 progress 時
   *    blob 是 null 但印記保留，跟著歸零會讓 `pristineOnly`
   *    （純潔者限定）內容對印記者誤判為可見而外洩劇透。
   */
  async hydrateAuthoritative(): Promise<void> {
    if (!adapter.loadAuthoritative) return; // 本地 adapter 沒有遠端概念
    const generation = adapterGeneration;
    const snapshot = await adapter.loadAuthoritative();
    if (generation !== adapterGeneration) return; // adapter 已更替，作廢
    if (!snapshot) return; // 讀不到伺服器，維持現狀等下一次

    const base = snapshot.state ?? createInitialState();
    state = { ...base, observerEver: snapshot.observerEver };
    void new LocalStorageAdapter().save(state);
    notify('hydrate');
  },

  /**
   * 重置進度。
   *
   * @param options.keepObserverEver 預設 true——觀測者印記是**同一個人**的
   *   永久標記，「重置我的進度」不該讓它消失。
   *
   *   登出必須傳 false：印記屬於**帳號**而非裝置。留著會造成跨帳號污染——
   *   登出後印記殘留在本機 state，下一位新註冊者登入時遠端進度為空，
   *   `setAdapter` 走「遠端無資料則上傳本地」把這份殘留推上去，
   *   而 Worker 的 observerEver 是單向 OR（已標記不可撤回），
   *   於是**無辜帳號被永久蓋上觀測者印記**。
   *   帳號自己的印記存在伺服器 `observer_ever` 欄位，下次登入自然回來。
   */
  reset(options?: { keepObserverEver?: boolean }): void {
    const keep = options?.keepObserverEver !== false;
    mutate('reset', (prev) => ({
      ...createInitialState(),
      observerEver: keep ? prev.observerEver : false,
    }));
  },

  /** 訂閱狀態變更，回傳取消訂閱函式 */
  subscribe(listener: Listener): () => void {
    listeners.push(listener);
    return () => {
      const i = listeners.indexOf(listener);
      if (i > -1) listeners.splice(i, 1);
    };
  },
};

/* ── window bridge（跨 React island 單例保證） ── */
if (typeof window !== 'undefined' && !window.__uepProgress) {
  window.__uepProgress = uepProgress;
}

/** 取得全域單例（優先 window bridge，SSR fallback 為 module 實例） */
export function getProgressManager(): typeof uepProgress {
  if (typeof window !== 'undefined' && window.__uepProgress) {
    return window.__uepProgress;
  }
  return uepProgress;
}
