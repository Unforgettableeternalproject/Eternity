/**
 * 保護樣式的命中測試邊界
 *
 * `pointer-events` 是繼承屬性，站上多層裝飾疊層（zone boot 立繪、退場中的
 * 遮罩）靠容器上那一次 none 讓整棵子樹一起失效。保護 CSS 是唯一一份對所有
 * Reader 頁面的 img 無差別生效的規則，在裡面碰 pointer-events 會把那些圖片
 * 單獨復活成命中目標——正式站上就這樣蓋掉了 Echoes 的播放按鈕，手機捲動也
 * 因為滾動鏈接不到 Reader 的捲動容器而形同失效。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  initContentProtection,
  FORCE_PROTECTION_KEY,
} from '../content-protection';

const styleText = () =>
  document.getElementById('uep-content-protection')?.textContent ?? '';

describe('保護 CSS', () => {
  beforeEach(() => {
    localStorage.setItem(FORCE_PROTECTION_KEY, 'true');
    initContentProtection();
  });

  afterEach(() => {
    localStorage.removeItem(FORCE_PROTECTION_KEY);
    document.getElementById('uep-content-protection')?.remove();
    document.getElementById('uep-protection-overlay')?.remove();
  });

  it('有注入樣式', () => {
    expect(styleText()).toContain('data-reader-page');
  });

  it('不碰 pointer-events——命中測試不歸內容保護管', () => {
    // 只找宣告（帶冒號）——註解裡講這件事本身是刻意留下的說明
    expect(styleText()).not.toMatch(/pointer-events\s*:/);
  });

  it('圖片保護只做拖曳這一件事', () => {
    expect(styleText()).toContain('user-drag: none');
  });
});
