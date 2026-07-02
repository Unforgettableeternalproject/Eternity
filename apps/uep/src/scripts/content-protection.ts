/**
 * 內容保護系統
 * 防止公開頁面的文字被反白複製、右鍵抓取等
 * - /admin/ 路徑下不啟用
 * - 開發模式下不攔截 DevTools
 */

/** 是否為管理頁面 */
const isAdmin = () => window.location.pathname.startsWith('/admin');

/** 是否為開發模式（Astro dev server 注入的 flag） */
const isDev = import.meta.env.DEV;

/** 需要放行的互動元素選擇器 */
const INTERACTIVE_SELECTOR =
  'input, textarea, select, button, [contenteditable]';

/**
 * 初始化內容保護
 * 在 DesignLayout 的 <script> 中呼叫
 */
export function initContentProtection(): void {
  // admin 頁面不啟用任何保護
  if (isAdmin()) return;

  setupCSSProtection();
  setupCopyProtection();
  setupContextMenuProtection();
  setupDragProtection();
  setupKeyboardProtection();
}

/** CSS：對 body 加上 user-select: none，互動元素例外 */
function setupCSSProtection(): void {
  const style = document.createElement('style');
  style.id = 'uep-content-protection';
  style.textContent = `
    /* 全域禁止反白 */
    body {
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
    }

    /* 互動元素放行 */
    input, textarea, select, [contenteditable="true"] {
      -webkit-user-select: text;
      -moz-user-select: text;
      -ms-user-select: text;
      user-select: text;
    }

    /* 防止圖片拖曳下載 */
    img {
      -webkit-user-drag: none;
      user-drag: none;
      pointer-events: auto;
    }
  `;
  document.head.appendChild(style);
}

/** 攔截 copy / cut 事件 */
function setupCopyProtection(): void {
  document.addEventListener('copy', (e) => {
    if (isInteractive(e.target as Element)) return;
    e.preventDefault();
  });

  document.addEventListener('cut', (e) => {
    if (isInteractive(e.target as Element)) return;
    e.preventDefault();
  });
}

/** 攔截右鍵選單 */
function setupContextMenuProtection(): void {
  document.addEventListener('contextmenu', (e) => {
    if (isInteractive(e.target as Element)) return;
    e.preventDefault();
  });
}

/** 防止文字與圖片拖曳 */
function setupDragProtection(): void {
  document.addEventListener('dragstart', (e) => {
    const target = e.target as Element;
    // 圖片和文字不允許拖曳
    if (target.tagName === 'IMG' || !isInteractive(target)) {
      e.preventDefault();
    }
  });
}

/** 攔截鍵盤快捷鍵 */
function setupKeyboardProtection(): void {
  document.addEventListener('keydown', (e) => {
    // 互動元素內放行所有快捷鍵
    if (isInteractive(e.target as Element)) return;

    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+C — 複製
    if (ctrl && e.key === 'c') {
      e.preventDefault();
      return;
    }

    // Ctrl+A — 全選
    if (ctrl && e.key === 'a') {
      e.preventDefault();
      return;
    }

    // Ctrl+U — 檢視原始碼
    if (ctrl && e.key === 'u') {
      e.preventDefault();
      return;
    }

    // DevTools 攔截（僅正式環境）
    if (!isDev) {
      // F12
      if (e.key === 'F12') {
        e.preventDefault();
        return;
      }

      // Ctrl+Shift+I（Elements）
      if (ctrl && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        return;
      }

      // Ctrl+Shift+J（Console）
      if (ctrl && e.shiftKey && e.key === 'J') {
        e.preventDefault();
        return;
      }

      // Ctrl+Shift+C（選取元素）
      if (ctrl && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        return;
      }
    }
  });
}

/** 判斷目標是否為互動元素（放行選取/複製） */
function isInteractive(target: Element | null): boolean {
  if (!target) return false;
  return (
    target.matches(INTERACTIVE_SELECTOR) ||
    target.closest(INTERACTIVE_SELECTOR) !== null
  );
}
