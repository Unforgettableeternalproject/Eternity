/**
 * UEP 本機儲存命名空間 — 掃描式清除（2026-07-26）
 *
 * 背景：三條「重置」路徑（DevTools 重置本機身分 / DevTools 完全重置 /
 * 真實登出）各自手抄一份 key 清單，結果每條都漏掉不同的東西——
 * `resetLocalIdentity` 漏 session、`progress:full-wipe` 連 pinned/terminal/
 * phantom/island 視窗都沒碰，卻對使用者宣稱「重載後就像全新訪客」。
 *
 * 手抄清單註定會漏：新增子系統的人沒有義務去翻遍所有 reset 入口。
 * 因此改為**掃描命名空間**——凡 key 落在 UEP 命名空間內一律清除，
 * 不需要任何登記動作。
 *
 * ⚠️ 隱性契約：**所有 UEP 的本機儲存 key 必須以 `uep.` 或 `uep-` 開頭**，
 * 否則清除時掃不到，會變成跨帳號殘留的髒資料。新增 key 時請遵守，
 * 並注意需要環境隔離的 key 另加 `:test` 後綴（見 `isTestMode()`）。
 */

/** UEP 擁有的 key 前綴。歷史上兩種風格並存，兩者都算數。 */
const UEP_KEY_PREFIXES = ['uep.', 'uep-'] as const;

/**
 * 清除時刻意保留的 key（艾斯維爾 2026-07-26 定案）。
 *
 * - `uep-devtools-force` / `uep-protection-force`：**開發旗標**而非使用者
 *   資料。一起清掉只會讓 DevTools／內容保護在重置後消失，妨礙緊接著
 *   要做的驗收。
 * - `uep-theme`：亮/暗主題屬**裝置級偏好**，與讀者身分無關。
 * - `uep-admin-token`：文件站 **admin 是另一套認證系統**（編輯者身分），
 *   撕下讀者識別證不該順手把人踢出後台。
 *
 * 反面案例（刻意**不**豁免）：`uep-visitor-tracked` 會被清除，因此重置
 * 後該瀏覽器會被 visitor-counter 重新計數一次——這是「變回全新訪客」
 * 的正確語意，代價是驗收期間反覆重置會讓訪客數偏高。
 */
const WIPE_EXEMPT_KEYS = new Set([
  'uep-devtools-force',
  'uep-protection-force',
  'uep-theme',
  'uep-admin-token',
]);

/**
 * 只用到的 Storage 介面片段。
 *
 * 刻意不寫 `Storage`——該 DOM 全域在本專案的 eslint 設定下會被 `no-undef`
 * 判為未定義。結構型別同樣接受 localStorage / sessionStorage，也讓測試
 * 可以餵假物件。
 */
interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

/** key 是否落在 UEP 命名空間 */
export function isUepStorageKey(key: string): boolean {
  return UEP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** 列出某個 Storage 裡所有該被清除的 UEP key（不含豁免項） */
export function collectUepStorageKeys(storage: KeyValueStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key === null) continue;
    if (!isUepStorageKey(key)) continue;
    if (WIPE_EXEMPT_KEYS.has(key)) continue;
    keys.push(key);
  }
  return keys;
}

/**
 * 清空單一 Storage 裡的所有 UEP key。
 *
 * 先收集再刪除——邊迭代邊 removeItem 會讓 `storage.key(i)` 的索引位移，
 * 造成隔一把漏刪。
 *
 * @returns 實際清除的 key 數量
 */
export function wipeUepStorage(storage: KeyValueStorage): number {
  let removed = 0;
  for (const key of collectUepStorageKeys(storage)) {
    try {
      storage.removeItem(key);
      removed += 1;
    } catch {
      // 單把 key 失敗不該中斷其餘清除
    }
  }
  return removed;
}

/**
 * 清空 localStorage 與 sessionStorage 裡的所有 UEP 本機狀態。
 *
 * 僅處理本機儲存——session 失效與 adapter 切換由 `wipeLocalIdentity()`
 * 負責，兩者的呼叫順序有嚴格要求，詳見該函式註解。
 */
export function wipeAllUepStorage(): number {
  if (typeof window === 'undefined') return 0;
  let removed = 0;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      if (storage) removed += wipeUepStorage(storage);
    } catch {
      // Storage 被禁用時靜默——重置是輔助功能，不該拋錯中斷
    }
  }
  return removed;
}
