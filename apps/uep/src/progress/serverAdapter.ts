/**
 * UEP 進度系統 — ServerAdapter（Epic 2 S5）
 *
 * 登入後接管進度儲存：
 * - load()：GET /api/uep/progress（伺服器優先；網路失敗時 fallback 本地鏡像）
 * - save()：write-through——立即寫 localStorage 鏡像 + debounce 合批 PUT 上傳。
 *   掃描線的 marker-update 很頻繁，絕不能每次 mutation 都打 Worker。
 *
 * 設計原則：進度同步失敗不阻斷閱讀（靜默容錯），登出後因為鏡像
 * 一直是新的，切回 LocalStorageAdapter 完全無縫。
 */

import { LocalStorageAdapter, normalizeState } from './adapters';
import type { ProgressAdapter, ProgressState } from './types';

/** debounce 預設間隔（毫秒） */
const DEFAULT_DEBOUNCE_MS = 2000;

export interface ServerAdapterOptions {
  /** content-api base URL */
  apiBase: string;
  /** 取得當前讀者 token；回傳 null 代表已登出（上傳直接放棄） */
  getToken: () => string | null;
  /** token 失效（401）時的回呼——由 auth 層清除 session */
  onAuthExpired?: () => void;
  /** debounce 間隔，測試用 */
  debounceMs?: number;
}

export class ServerAdapter implements ProgressAdapter {
  private readonly local = new LocalStorageAdapter();
  private readonly opts: Required<
    Pick<ServerAdapterOptions, 'apiBase' | 'getToken' | 'debounceMs'>
  > &
    Pick<ServerAdapterOptions, 'onAuthExpired'>;

  private pending: ProgressState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onPageHide = () => {
    void this.flush(true);
  };

  constructor(options: ServerAdapterOptions) {
    this.opts = {
      apiBase: options.apiBase.replace(/\/$/, ''),
      getToken: options.getToken,
      onAuthExpired: options.onAuthExpired,
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    };
    // 離開頁面時把未上傳的進度沖出去（keepalive 讓請求在 unload 後存活）
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void this.flush(true);
  };

  /** 移除事件監聽並沖出殘留進度（登出/切換 adapter 時呼叫） */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void this.flush(true);
  }

  async load(): Promise<ProgressState | null> {
    const token = this.opts.getToken();
    if (!token) return null;
    try {
      const res = await fetch(`${this.opts.apiBase}/api/uep/progress`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        this.opts.onAuthExpired?.();
        return null;
      }
      if (!res.ok) {
        // 伺服器暫時性錯誤：fallback 本地鏡像，不阻斷閱讀
        return this.local.loadSync();
      }
      const json = (await res.json()) as { ok: boolean; data?: unknown };
      if (!json.ok) return this.local.loadSync();
      // data === null 代表帳號尚無雲端進度（store 會上傳本地作為初始值）
      if (json.data === null || json.data === undefined) return null;
      return normalizeState(json.data);
    } catch {
      // 離線：fallback 本地鏡像
      return this.local.loadSync();
    }
  }

  save(state: ProgressState): Promise<void> {
    // write-through：本地鏡像永遠即時，登出切回 LocalStorageAdapter 無縫
    void this.local.save(state);
    this.pending = state;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.debounceMs);
    return Promise.resolve();
  }

  /** 立即上傳未送出的進度。keepalive=true 用於 pagehide（unload 後請求仍存活） */
  async flush(keepalive = false): Promise<void> {
    if (!this.pending) return;
    const token = this.opts.getToken();
    if (!token) {
      // 已登出：放棄上傳（本地鏡像已保存）
      this.pending = null;
      return;
    }
    const body = JSON.stringify(this.pending);
    this.pending = null;
    try {
      const res = await fetch(`${this.opts.apiBase}/api/uep/progress`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
        keepalive,
      });
      if (res.status === 401) {
        this.opts.onAuthExpired?.();
      }
      // 其他錯誤：靜默——下次 save 會帶著最新狀態重試
    } catch {
      // 網路失敗：靜默，本地鏡像已是最新，之後的 save 會重試
    }
  }
}
