/**
 * DevTools Action Registry（Issue #41 T-16）
 *
 * Plugin 式 action 註冊機制：各功能模組（progress / islands / onboarding /
 * audio / animations）在自己的 `<xxx>Actions.ts` 內呼叫 `register()`，
 * 面板 UI 從此 registry 取清單渲染。這樣新增動作不用改 UI 檔案。
 *
 * Runtime：window bridge singleton `window.__uepDevTools`，
 * 與 progressStore / islandRuntime 同模式，方便從 console 存取。
 */

import { GROUP_ORDER } from './groups';

/** 單一 devtool 動作 */
export interface DevToolAction {
  /** 群組名稱。一律用 `groups.ts` 的 `GROUPS` 常數，不要寫字面字串 */
  group: string;
  /** 動作唯一 ID（kebab-case，如 `progress:reset`）；重複註冊會覆蓋並警告 */
  id: string;
  /** 面板顯示名稱 */
  label: string;
  /** 說明文字（選填） */
  description?: string;
  /** 執行函式，可 async；異常會被 registry 捕捉並回報 */
  execute: () => void | Promise<void>;
  /** 是否需要二次確認（顯示 confirm 對話後才執行） */
  requiresConfirm?: boolean;
  /** 二次確認的訊息（若 requiresConfirm 為 true） */
  confirmMessage?: string;
  /** 是否為破壞性動作（UI 用不同顏色標示） */
  destructive?: boolean;
  /** 是否目前可執行（false → UI disabled；用於「某頁面才可用」的動作） */
  available?: () => boolean;
}

/** Registry 執行結果，透過 CustomEvent 廣播給 UI */
export interface DevToolExecuteResult {
  id: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface DevToolsRegistry {
  register(actions: DevToolAction[]): void;
  unregister(ids: string[]): void;
  getAll(): DevToolAction[];
  getGroups(): string[];
  dispatch(id: string): Promise<DevToolExecuteResult>;
  /** 訂閱執行結果（面板顯示 toast 用）；回傳 unsubscribe */
  onResult(handler: (result: DevToolExecuteResult) => void): () => void;
}

declare global {
  interface Window {
    __uepDevTools?: DevToolsRegistry;
  }
}

/** 建立單一 registry 實例（模組首次 import 時執行） */
function createRegistry(): DevToolsRegistry {
  const actions = new Map<string, DevToolAction>();
  const resultHandlers = new Set<(r: DevToolExecuteResult) => void>();

  return {
    register(next: DevToolAction[]): void {
      for (const action of next) {
        if (actions.has(action.id)) {
          // 允許覆蓋（HMR 場景常見），但警告以免生產環境重複註冊被吞
          // eslint-disable-next-line no-console
          console.warn(
            `[DevTools] 覆蓋既有 action id="${action.id}"（原 group=${actions.get(action.id)?.group}）`
          );
        }
        actions.set(action.id, action);
      }
    },

    unregister(ids: string[]): void {
      for (const id of ids) actions.delete(id);
    },

    getAll(): DevToolAction[] {
      // 依 group 分組 + group 內按 label 排序，穩定輸出
      return [...actions.values()].sort((a, b) => {
        const g = a.group.localeCompare(b.group, 'zh-Hant');
        return g !== 0 ? g : a.label.localeCompare(b.label, 'zh-Hant');
      });
    },

    getGroups(): string[] {
      const set = new Set<string>();
      for (const action of actions.values()) set.add(action.group);
      // 依 GROUP_ORDER 排——中文 localeCompare 的順序對使用者沒有意義，
      // 而「常用的排前面」有。不在清單裡的（外掛／未來新增）排到最後
      return [...set].sort((a, b) => {
        const ia = GROUP_ORDER.indexOf(a);
        const ib = GROUP_ORDER.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b, 'zh-Hant');
      });
    },

    async dispatch(id: string): Promise<DevToolExecuteResult> {
      const action = actions.get(id);
      const start = performance.now();
      if (!action) {
        const result: DevToolExecuteResult = {
          id,
          ok: false,
          error: `未註冊的 action id="${id}"`,
          durationMs: 0,
        };
        for (const h of resultHandlers) h(result);
        return result;
      }
      try {
        await action.execute();
        const result: DevToolExecuteResult = {
          id,
          ok: true,
          durationMs: Math.round(performance.now() - start),
        };
        for (const h of resultHandlers) h(result);
        return result;
      } catch (err) {
        const result: DevToolExecuteResult = {
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Math.round(performance.now() - start),
        };
        for (const h of resultHandlers) h(result);
        return result;
      }
    },

    onResult(handler): () => void {
      resultHandlers.add(handler);
      return () => {
        resultHandlers.delete(handler);
      };
    },
  };
}

/** 全站唯一 registry 實例（透過 window bridge 給 console + panel 共用） */
export function getRegistry(): DevToolsRegistry {
  if (typeof window === 'undefined') {
    // SSR 情境：回一個 no-op registry 讓 import 端不 crash
    return createRegistry();
  }
  if (!window.__uepDevTools) {
    window.__uepDevTools = createRegistry();
  }
  return window.__uepDevTools;
}
