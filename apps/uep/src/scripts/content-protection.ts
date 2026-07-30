/**
 * 內容保護系統
 * 防止 Reader 頁面的文字被反白複製、右鍵抓取、截圖等
 * - 只在 Reader 頁面（body[data-reader-page="true"]）啟用
 * - /admin/ 路徑下永遠不啟用
 * - 正式環境（非 dev、非測試模式）：全部啟用，不可關閉
 * - 開發環境 / 測試模式（staging build-bound 或 test cookie）：
 *   預設全部關閉，可透過 __uepProtection.enable() 或 DevTools 面板強制開啟
 */

import { isTestMode } from '../lib/apiBase';
import { getSetting } from '../lib/uepSettings';

/** 是否為管理頁面 */
const isAdmin = () => window.location.pathname.startsWith('/admin');

/** 是否為開發模式（Astro dev server 注入的 flag） */
const isDev = import.meta.env.DEV;

/** 非正式環境強制啟用內容保護的 localStorage key */
export const FORCE_PROTECTION_KEY = 'uep-protection-force';

/** 是否強制啟用內容保護（dev / 測試模式的 opt-in 開關） */
export const isProtectionForced = (): boolean => {
  try {
    return localStorage.getItem(FORCE_PROTECTION_KEY) === 'true';
  } catch {
    return false;
  }
};

/**
 * 非正式環境判定：本地 dev 或測試模式（staging 前端 build-bound
 * 指向 test worker、或 test cookie override）。這些環境保護預設關閉，
 * 讓 DevTools / 驗收操作不被自己擋住；只有真正式環境不可關閉。
 */
const isNonProdEnv = (): boolean => isDev || isTestMode();

/**
 * 是否應啟用所有內容保護。
 *
 * `protection.mode` 站台設定（/admin/settings）的三態：
 * - `always`／`never`：無視環境一律開／關
 * - `env`（預設）：沿用現行判定——正式環境永遠啟用；dev / 測試模式需 opt-in
 *
 * 設定未載入（首訪第一頁）時 getSetting 退回 'env'，即現行行為。
 */
const shouldEnableProtection = (): boolean => {
  const mode = getSetting<string>('protection.mode', 'env');
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return isNonProdEnv() ? isProtectionForced() : true;
};

/** 目前頁面是否為 Reader 頁面（由 ReaderShell 掛載時設定 body attribute） */
const isReaderPage = (): boolean =>
  document.body?.dataset?.readerPage === 'true';

/** 需要放行的互動元素選擇器 */
const INTERACTIVE_SELECTOR =
  'input, textarea, select, button, [contenteditable]';

/** 遮罩顯示時間（毫秒） */
const OVERLAY_DURATION_MS = 1500;

/** 遮罩淡出時間（毫秒） */
const OVERLAY_FADE_MS = 400;

/**
 * 「重新接上訊號」退場總時長（毫秒）
 *
 * 遮罩消失不是單純淡出：保護畫面先斷電，露出底下被 backdrop-filter 灰階化
 * 的內容，再帶著雜訊與短暫抖動逐步還原飽和度——像訊號重新接回來
 * （艾斯維爾 2026-07-26 回饋）。
 *
 * JS 這側只負責在時間到後拆掉 data-restoring，不依賴 animationend——
 * prefers-reduced-motion 下動畫整組停用，事件永遠不會來。
 */
const OVERLAY_RESTORE_MS = 1400;

/**
 * 初始化內容保護
 * 在 DesignLayout 的 <script> 中呼叫
 */
export function initContentProtection(): void {
  // admin 頁面不啟用任何保護
  if (isAdmin()) return;

  // 無論如何都暴露 dev toolkit，讓開發者能在 console 切換
  exposeDevToolkit();

  // 開發環境未強制啟用時，跳過所有保護（維持正常開發體驗）
  if (!shouldEnableProtection()) return;

  // 基本保護（反白/複製/右鍵/拖曳/快捷鍵）
  setupCSSProtection();
  setupCopyProtection();
  setupContextMenuProtection();
  setupDragProtection();
  setupKeyboardProtection();

  // 截圖相關保護（PrintScreen + 失焦遮蔽 + 遮罩節點）
  setupProtectionOverlay();
  setupPrintScreenProtection();
  setupVisibilityProtection();
}

/**
 * 暴露開發者控制介面到 window
 * 用法（在瀏覽器 console，僅 dev / 測試模式有效——正式環境永遠開啟）：
 *   __uepProtection.enable()   // 開啟強制模式（重新載入生效）
 *   __uepProtection.disable()  // 關閉強制模式
 *   __uepProtection.status()   // 查看目前狀態
 *   __uepProtection.test()     // 立即閃現遮罩（不改變設定）
 */
function exposeDevToolkit(): void {
  const toolkit = {
    enable() {
      try {
        localStorage.setItem(FORCE_PROTECTION_KEY, 'true');
        // eslint-disable-next-line no-console
        console.info('[UEP Protection] 強制模式已開啟。重新載入頁面後生效。');
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[UEP Protection] 無法寫入 localStorage。');
      }
    },
    disable() {
      if (!isNonProdEnv()) {
        // eslint-disable-next-line no-console
        console.warn('[UEP Protection] 正式環境的內容保護不可關閉。');
        return;
      }
      try {
        localStorage.removeItem(FORCE_PROTECTION_KEY);
        // eslint-disable-next-line no-console
        console.info('[UEP Protection] 強制模式已關閉。重新載入頁面後生效。');
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[UEP Protection] 無法寫入 localStorage。');
      }
    },
    status() {
      const forced = isProtectionForced();
      const testMode = isTestMode();
      const active = shouldEnableProtection();
      const readerPage = isReaderPage();
      const effective = active && readerPage;
      // eslint-disable-next-line no-console
      console.info(
        `[UEP Protection] isDev=${isDev} testMode=${testMode} forced=${forced} readerPage=${readerPage} protection=${active ? 'ON' : 'OFF'} effective=${effective ? 'YES' : 'NO'}`
      );
      return { isDev, testMode, forced, readerPage, active, effective };
    },
    test() {
      // 即時測試遮罩外觀——若尚未 setup 則臨時 setup
      if (!document.getElementById('uep-protection-overlay')) {
        setupProtectionOverlay();
      }
      showProtectionOverlay();
      // eslint-disable-next-line no-console
      console.info('[UEP Protection] 已觸發測試遮罩。');
    },
  };

  (window as unknown as { __uepProtection: typeof toolkit }).__uepProtection =
    toolkit;
}

/** CSS：只在 Reader 頁面禁止反白，互動元素例外 */
function setupCSSProtection(): void {
  const style = document.createElement('style');
  style.id = 'uep-content-protection';
  style.textContent = `
    /* Reader 頁面禁止反白 */
    body[data-reader-page="true"] {
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
    }

    /* 互動元素放行（僅在 Reader 頁面內生效即可） */
    body[data-reader-page="true"] input,
    body[data-reader-page="true"] textarea,
    body[data-reader-page="true"] select,
    body[data-reader-page="true"] [contenteditable="true"] {
      -webkit-user-select: text;
      -moz-user-select: text;
      -ms-user-select: text;
      user-select: text;
    }

    /* Reader 頁面防止圖片拖曳下載 */
    body[data-reader-page="true"] img {
      -webkit-user-drag: none;
      user-drag: none;
      pointer-events: auto;
    }
  `;
  document.head.appendChild(style);
}

/** 攔截 copy / cut 事件（僅 Reader 頁面） */
function setupCopyProtection(): void {
  document.addEventListener('copy', (e) => {
    if (!isReaderPage()) return;
    if (isInteractive(e.target as Element)) return;
    e.preventDefault();
  });

  document.addEventListener('cut', (e) => {
    if (!isReaderPage()) return;
    if (isInteractive(e.target as Element)) return;
    e.preventDefault();
  });
}

/** 攔截右鍵選單（僅 Reader 頁面） */
function setupContextMenuProtection(): void {
  document.addEventListener('contextmenu', (e) => {
    if (!isReaderPage()) return;
    if (isInteractive(e.target as Element)) return;
    e.preventDefault();
  });
}

/** 防止文字與圖片拖曳（僅 Reader 頁面） */
function setupDragProtection(): void {
  document.addEventListener('dragstart', (e) => {
    if (!isReaderPage()) return;
    const target = e.target as Element;
    // 圖片和文字不允許拖曳
    if (target.tagName === 'IMG' || !isInteractive(target)) {
      e.preventDefault();
    }
  });
}

/** 攔截鍵盤快捷鍵（僅 Reader 頁面） */
function setupKeyboardProtection(): void {
  document.addEventListener('keydown', (e) => {
    if (!isReaderPage()) return;
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

/**
 * 建立保護遮罩 DOM 與樣式
 *
 * ── 未來替換保護頁面圖 ──
 * 把圖片放到 `apps/uep/public/protection/xxx.png`（或其他格式），
 * 然後改下方 CSS 的 `--uep-protection-image` 變數：
 *   --uep-protection-image: url('/protection/xxx.png');
 * 或在 body/html 上動態設置 style 覆寫即可，不必動這支腳本。
 */
function setupProtectionOverlay(): void {
  // 樣式
  const style = document.createElement('style');
  style.id = 'uep-protection-overlay-style';
  style.textContent = `
    :root {
      /* Placeholder fallback — 之後可覆寫 --uep-protection-image 指向實際保護頁面圖 */
      --uep-protection-bg: radial-gradient(
        ellipse at center,
        rgba(20, 20, 26, 1) 0%,
        rgba(8, 8, 12, 1) 100%
      );
    }

    /* 外層只負責定位與退場的訊號還原（backdrop-filter 作用於底下內容）。
       保護畫面本體移到 __plate：退場時要先讓不透明的畫面斷電消失，
       才看得到底下正在還原的灰階內容。

       ⚠️ 不要把 filter/backdrop-filter 之類的濾鏡加到 body 或 Reader 容器上
       去做灰階——那會建立 containing block，讓所有 position:fixed 後代
       （浮島、對話遮罩）退化為相對定位。灰階一律由這層遮罩自己的
       backdrop-filter 負責。 */
    .uep-protection-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647; /* 頂到最高 */
      color: #f5f5f0;
      font-family: var(--font-family-serif, 'Noto Serif TC', serif);
      letter-spacing: 0.15em;
      opacity: 0;
      pointer-events: none;
      /* 預設 transition 用於「淡出」——隱藏時才緩慢消失 */
      transition: opacity ${OVERLAY_FADE_MS}ms ease;
      user-select: none;
    }

    .uep-protection-overlay[data-visible="true"] {
      opacity: 1;
      pointer-events: all;
      /* 顯示時瞬間切換——避免淡入過程中看到背景內容 */
      transition: opacity 0ms;
    }

    .uep-protection-overlay__plate {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1.25rem;
      /* 底色純黑保底 */
      background-color: #08080c;
      /* image 未定義時 fallback 到 gradient placeholder */
      background-image: var(--uep-protection-image, var(--uep-protection-bg));
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
    }

    /* 訊號斷開的雜訊層：feTurbulence 產生的靜態雜訊，退場時閃現後散去。
       不用 mix-blend-mode——外層 opacity/animation 已建立 stacking context，
       混合對象只會是同層的 plate（退場時已透明），混不到底下的頁面內容。
       改用灰階化的半透明雜點直接疊上去，就是斷訊的雪花。 */
    .uep-protection-overlay__noise {
      position: absolute;
      inset: -20%;
      opacity: 0;
      pointer-events: none;
      filter: grayscale(1) contrast(1.5);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.85'/%3E%3C/svg%3E");
    }

    /* ── 退場：訊號重新接上 ──
       plate 先斷電（快），外層維持在場並以 backdrop-filter 把底下內容
       從灰階拉回飽和，雜訊同時閃現散去，中途帶兩次橫向抖動。 */
    .uep-protection-overlay[data-restoring="true"] {
      opacity: 1;
      animation: uep-protection-restore ${OVERLAY_RESTORE_MS}ms
        cubic-bezier(0.33, 0, 0.2, 1) forwards;
    }

    .uep-protection-overlay[data-restoring="true"] .uep-protection-overlay__plate {
      opacity: 0;
      transition: opacity 200ms ease-out;
    }

    .uep-protection-overlay[data-restoring="true"] .uep-protection-overlay__noise {
      animation: uep-protection-noise ${OVERLAY_RESTORE_MS}ms linear forwards;
    }

    /* 百分比是照 1.4s 的總長換算的：抖動集中在前 170ms（拉長總時間不該
       讓 glitch 也跟著變慢），灰階則刻意在中段賴著不走，最後三分之一
       才收乾。 */
    @keyframes uep-protection-restore {
      0% {
        opacity: 1;
        -webkit-backdrop-filter: grayscale(1) contrast(1.12) brightness(0.82);
        backdrop-filter: grayscale(1) contrast(1.12) brightness(0.82);
        transform: translateX(0);
      }
      6% { transform: translateX(-3px); }
      9% { transform: translateX(2px); }
      12% { transform: translateX(0); }
      30% {
        opacity: 0.94;
        -webkit-backdrop-filter: grayscale(0.94) contrast(1.1) brightness(0.85);
        backdrop-filter: grayscale(0.94) contrast(1.1) brightness(0.85);
      }
      34% { transform: translateX(2px); }
      38% { transform: translateX(0); }
      62% {
        opacity: 0.6;
        -webkit-backdrop-filter: grayscale(0.62) contrast(1.05) brightness(0.93);
        backdrop-filter: grayscale(0.62) contrast(1.05) brightness(0.93);
      }
      74% { transform: translateX(-1.5px); }
      78% { transform: translateX(0); }
      100% {
        opacity: 0;
        -webkit-backdrop-filter: grayscale(0) contrast(1) brightness(1);
        backdrop-filter: grayscale(0) contrast(1) brightness(1);
        transform: translateX(0);
      }
    }

    /* 段落切得比還原曲線細——雜訊要一直在抽動，不能是一團緩慢漂移的紋理 */
    @keyframes uep-protection-noise {
      0% { opacity: 0.5; background-position: 0 0; }
      7% { opacity: 0.34; background-position: 14px -9px; }
      14% { opacity: 0.48; background-position: -12px 11px; }
      21% { opacity: 0.36; background-position: 9px 15px; }
      29% { opacity: 0.46; background-position: -15px -7px; }
      37% { opacity: 0.33; background-position: 12px 6px; }
      45% { opacity: 0.42; background-position: -8px 13px; }
      54% { opacity: 0.3; background-position: 16px -11px; }
      63% { opacity: 0.34; background-position: -11px 9px; }
      72% { opacity: 0.22; background-position: 6px -13px; }
      82% { opacity: 0.16; background-position: -7px 5px; }
      91% { opacity: 0.08; background-position: 4px 8px; }
      100% { opacity: 0; background-position: 0 0; }
    }

    /* 動態效果全停用時退回單純淡出——灰階/雜訊/抖動都是動態語彙 */
    @media (prefers-reduced-motion: reduce) {
      .uep-protection-overlay[data-restoring="true"] {
        animation: none;
        opacity: 0;
        transition: opacity ${OVERLAY_FADE_MS}ms ease;
      }

      .uep-protection-overlay[data-restoring="true"] .uep-protection-overlay__plate {
        transition: none;
      }

      .uep-protection-overlay__noise {
        animation: none !important;
        opacity: 0 !important;
      }
    }

    .uep-protection-overlay__plate::before {
      /* Scanline 質感，圖片放上去時可透過 background-blend-mode 融合 */
      content: '';
      position: absolute;
      inset: 0;
      background: repeating-linear-gradient(
        0deg,
        rgba(255, 255, 255, 0.025) 0px,
        rgba(255, 255, 255, 0.025) 1px,
        transparent 1px,
        transparent 3px
      );
      pointer-events: none;
      animation: uep-protection-scanline-flicker 4s ease-in-out infinite;
    }

    .uep-protection-overlay__plate::after {
      /* 隨機橫向掃描條，緩慢掃過（低調） */
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      height: 6vh;
      background: linear-gradient(
        180deg,
        transparent 0%,
        rgba(255, 255, 255, 0.03) 45%,
        rgba(255, 255, 255, 0.05) 50%,
        rgba(255, 255, 255, 0.03) 55%,
        transparent 100%
      );
      pointer-events: none;
      mix-blend-mode: screen;
      animation: uep-protection-sweep 9s ease-in-out infinite;
    }

    .uep-protection-overlay__title {
      position: relative;
      font-size: clamp(1.75rem, 4vw, 2.5rem);
      font-weight: 300;
      letter-spacing: 0.3em;
      color: #f5f5f0;
      text-shadow:
        0 0 20px rgba(200, 180, 140, 0.35),
        0 0 3px rgba(255, 255, 255, 0.25);
      animation: uep-protection-glitch 4.2s ease-in-out infinite;
    }

    /* RGB 色差複影：以 data-text 屬性複製文字疊層（微弱） */
    .uep-protection-overlay__title::before,
    .uep-protection-overlay__title::after {
      content: attr(data-text);
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      pointer-events: none;
      mix-blend-mode: screen;
      letter-spacing: inherit;
    }

    .uep-protection-overlay__title::before {
      color: rgba(255, 60, 90, 0.35);
      animation: uep-protection-shift-r 5s ease-in-out infinite;
    }

    .uep-protection-overlay__title::after {
      color: rgba(80, 200, 255, 0.35);
      animation: uep-protection-shift-b 4.6s ease-in-out infinite;
    }

    .uep-protection-overlay__sub {
      position: relative;
      font-size: 0.85rem;
      opacity: 0.6;
      letter-spacing: 0.4em;
      text-transform: uppercase;
      animation: uep-protection-flicker 3.2s ease-in-out infinite;
    }

    .uep-protection-overlay__mark {
      position: absolute;
      bottom: 2rem;
      right: 2rem;
      font-size: 0.7rem;
      opacity: 0.3;
      letter-spacing: 0.3em;
    }

    /* ── 動畫定義（輕度扭曲/雜訊） ── */
    @keyframes uep-protection-glitch {
      0%, 100% { transform: translate(0, 0); opacity: 1; }
      20% { transform: translate(0, 0); opacity: 0.96; }
      40% { transform: translate(-1px, 0); opacity: 1; }
      50% { transform: translate(-1px, 0); opacity: 0.88; }
      52% { transform: translate(0, 0); opacity: 1; }
      70% { transform: translate(1px, 0); opacity: 1; }
      85% { transform: translate(0, 0); opacity: 0.94; }
    }

    @keyframes uep-protection-shift-r {
      0%, 100% { transform: translate(-1px, 0); }
      30% { transform: translate(-2px, 0); }
      60% { transform: translate(-1px, 1px); }
      80% { transform: translate(-2px, 0); }
    }

    @keyframes uep-protection-shift-b {
      0%, 100% { transform: translate(1px, 0); }
      30% { transform: translate(2px, 0); }
      60% { transform: translate(1px, -1px); }
      80% { transform: translate(2px, 0); }
    }

    @keyframes uep-protection-flicker {
      0%, 100% { opacity: 0.6; }
      45% { opacity: 0.5; }
      50% { opacity: 0.65; }
      75% { opacity: 0.55; }
    }

    @keyframes uep-protection-scanline-flicker {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.75; }
    }

    @keyframes uep-protection-sweep {
      0% { top: -10vh; opacity: 0; }
      15% { opacity: 0.5; }
      50% { opacity: 0.35; }
      85% { opacity: 0.5; }
      100% { top: 110vh; opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  // 遮罩節點（預先建立，隱藏中）
  const overlay = document.createElement('div');
  overlay.className = 'uep-protection-overlay';
  overlay.id = 'uep-protection-overlay';
  overlay.setAttribute('data-visible', 'false');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="uep-protection-overlay__plate">
      <div class="uep-protection-overlay__title" data-text="觀測失效">觀測失效</div>
      <div class="uep-protection-overlay__sub">Observation Failed</div>
      <div class="uep-protection-overlay__mark">UEP · ${new Date().toISOString().slice(0, 10)}</div>
    </div>
    <div class="uep-protection-overlay__noise" aria-hidden="true"></div>
  `;

  // body 可能尚未就緒
  if (document.body) {
    document.body.appendChild(overlay);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(overlay);
    });
  }
}

let overlayTimer: number | null = null;
let restoreTimer: number | null = null;

/** 顯示遮罩的共用起點：清掉退場狀態，避免上一次還原尚未走完就重新遮蔽 */
function markOverlayVisible(overlay: HTMLElement): void {
  if (restoreTimer !== null) {
    window.clearTimeout(restoreTimer);
    restoreTimer = null;
  }
  overlay.removeAttribute('data-restoring');
  overlay.setAttribute('data-visible', 'true');
  overlay.setAttribute('aria-hidden', 'false');
}

/** 顯示保護遮罩（自動退場） */
function showProtectionOverlay(): void {
  const overlay = document.getElementById('uep-protection-overlay');
  if (!overlay) return;

  markOverlayVisible(overlay);

  if (overlayTimer !== null) {
    window.clearTimeout(overlayTimer);
  }
  overlayTimer = window.setTimeout(() => {
    overlayTimer = null;
    hideProtectionOverlay();
  }, OVERLAY_DURATION_MS);
}

/** 立即顯示遮罩、不自動退場（用於失焦持續遮蔽） */
function showProtectionOverlaySticky(): void {
  const overlay = document.getElementById('uep-protection-overlay');
  if (!overlay) return;

  if (overlayTimer !== null) {
    window.clearTimeout(overlayTimer);
    overlayTimer = null;
  }
  markOverlayVisible(overlay);
}

/** 隱藏保護遮罩——走「重新接上訊號」的退場（雜訊 + 灰階還原） */
function hideProtectionOverlay(): void {
  const overlay = document.getElementById('uep-protection-overlay');
  if (!overlay) return;

  if (overlayTimer !== null) {
    window.clearTimeout(overlayTimer);
    overlayTimer = null;
  }

  const wasVisible = overlay.getAttribute('data-visible') === 'true';
  overlay.setAttribute('data-visible', 'false');
  overlay.setAttribute('aria-hidden', 'true');

  /* 本來就不可見（例如重覆 focus 事件）不必再演一次還原 */
  if (!wasVisible) return;

  overlay.setAttribute('data-restoring', 'true');
  if (restoreTimer !== null) window.clearTimeout(restoreTimer);
  restoreTimer = window.setTimeout(() => {
    overlay.removeAttribute('data-restoring');
    restoreTimer = null;
  }, OVERLAY_RESTORE_MS);
}

/**
 * PrintScreen 攔截
 * 只能攔截頁面 focus 時按下 PrintScreen 的情境，
 * 作業系統截圖工具（Snipping Tool / Win+Shift+S）無法攔截。
 */
function setupPrintScreenProtection(): void {
  document.addEventListener('keyup', (e) => {
    if (!isReaderPage()) return;
    if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
      // 嘗試清空剪貼簿（有失敗風險，但無視即可）
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText('').catch(() => {
            /* 沒授權就算了 */
          });
        }
      } catch {
        /* noop */
      }
      showProtectionOverlay();
    }
  });

  // keydown 也擋一下，某些鍵盤佈局在 keydown 就觸發截圖
  document.addEventListener('keydown', (e) => {
    if (!isReaderPage()) return;
    if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
      e.preventDefault();
    }
  });
}

/**
 * 失焦遮蔽（僅 Reader 頁面）
 * 使用者切到別的視窗/分頁（可能開截圖工具）時遮蔽內容，
 * 回到本頁時淡出。
 */
function setupVisibilityProtection(): void {
  document.addEventListener('visibilitychange', () => {
    if (!isReaderPage()) return;
    if (document.visibilityState === 'hidden') {
      showProtectionOverlaySticky();
    } else {
      hideProtectionOverlay();
    }
  });

  window.addEventListener('blur', () => {
    if (!isReaderPage()) return;
    showProtectionOverlaySticky();
  });

  window.addEventListener('focus', () => {
    if (!isReaderPage()) return;
    hideProtectionOverlay();
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
