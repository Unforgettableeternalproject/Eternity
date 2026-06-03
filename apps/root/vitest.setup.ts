import '@testing-library/jest-dom/vitest';

/**
 * 主站測試設定檔
 *
 * 載入 @testing-library/jest-dom 的自訂 matcher。
 * 這個檔案在每個測試檔案執行前自動載入。
 */

// 模擬 window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
