/**
 * 浮島樣式的延後注入
 *
 * 為什麼不用一般的 `import './X.css'`：
 * Astro 會把 client island 依賴樹裡的**所有** CSS 提為 route 的
 * `<link rel="stylesheet">`，包含 `React.lazy` 動態載入的子元件。
 * 結果是浮島的 JS 懶載了、CSS 沒有——五座島加便條層約 100KB 原始 CSS
 * 全都躺在阻斷算繪的樣式表裡，而 IslandHost 掛在 TopBar，**全站每一頁**
 * 都在付這筆錢（2026-08-09 PageSpeed 行動版：首頁阻斷算繪的 CSS
 * 34.1KiB／2080ms，其中 index.css 一支 25.7KiB 就是這些島）。
 *
 * 改用 `?inline` 讓 CSS 以字串進 lazy chunk，Astro 眼中它只是 JS
 * 常數而不是樣式資產，於是不會被提為 route stylesheet；真正展開島時
 * 才隨那支 chunk 一起下載並注入。
 *
 * ⚠️ 用 `useInsertionEffect` 而非 `useEffect`：前者在 React 提交 DOM
 * 變更**之前**執行，樣式與節點同一幀到位。用 useEffect 的話島會先以
 * 無樣式的姿態畫一幀，展開瞬間閃一下。
 *
 * 注入後刻意不移除——島開開關關是常態，反覆插拔只是讓瀏覽器重複解析
 * 同一份 CSS，而多留一個 <style> 沒有任何代價。
 */

import { useInsertionEffect } from 'react';

/** 已注入的樣式 id，避免同一份 CSS 重複插入 */
const injected = new Set<string>();

/**
 * 把 CSS 字串注入 head（同一個 id 只會注入一次）。
 *
 * @param id      樣式識別碼，寫進 `data-uep-style` 供除錯辨認
 * @param css     `import css from './X.css?inline'` 得到的字串
 * @param enabled 為 false 時不注入。給「元件掛著但這次不會畫出來」的情形
 *                （如識別證未登入時 return null）——hook 本身仍無條件呼叫，
 *                只有效果有條件，不違反 hooks 規則
 */
export function useDeferredStyle(
  id: string,
  css: string,
  enabled = true
): void {
  useInsertionEffect(() => {
    if (!enabled || injected.has(id)) return;
    injected.add(id);
    const el = document.createElement('style');
    el.dataset.uepStyle = id;
    el.textContent = css;
    document.head.appendChild(el);
  }, [id, css, enabled]);
}
