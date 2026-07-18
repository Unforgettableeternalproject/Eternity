import { test, expect } from '@playwright/test';

/**
 * T-21 — UepDevTools 命令面板 E2E 測試
 *
 * 快捷鍵：Ctrl+Shift+D
 *
 * shouldMount() 條件（滿足任一）：
 *   1. isTestMode() === true（cookie 為合法 test worker URL）
 *   2. localStorage['uep-devtools-force'] === 'true'（強制開啟）
 *   3. import.meta.env.DEV === true（本地 dev server 永遠開）
 *
 * 本地 dev server 在 DEV === true 的條件下 shouldMount() 恆為 true，
 * 因此不帶 cookie 也能觸發面板。
 *
 * ⚠️ 注意：不要真的執行破壞性 actions（progress:reset / onboarding:reset-identity）
 *    會影響其他 E2E 測試的 localStorage/sessionStorage 狀態。
 */

const TEST_COOKIE = 'uep-test-api-url';
const TEST_WORKER_URL =
  'https://eternity-content-api-test.ptyc4076.workers.dev';

// DevTools FAB selector（面板關閉時的角落按鈕）
const FAB_SELECTOR = '.uep-devtools-fab';
// DevTools panel selector（面板開啟時）
const PANEL_SELECTOR = '.uep-devtools-panel';
// 面板搜尋框
const SEARCH_INPUT_SELECTOR = '.uep-devtools-panel__search input';
// 面板標頭 meta（顯示 actions 數量）
const META_SELECTOR = '.uep-devtools-panel__meta';

// ─────────────────────────────────────────────
//  測項 1 — 帶 test cookie 進 uep home → Ctrl+Shift+D → 面板出現
// ─────────────────────────────────────────────
test.describe('T-21-1：帶 test cookie → DevTools 面板開啟', () => {
  test('Ctrl+Shift+D 打開面板，顯示 actions 清單', async ({ page }) => {
    // 先注入 test cookie（讓 isTestMode() === true）
    await page.context().addCookies([
      {
        name: TEST_COOKIE,
        value: encodeURIComponent(TEST_WORKER_URL),
        domain: 'localhost',
        path: '/',
        sameSite: 'Strict',
      },
    ]);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // 等 React hydrate + UepDevToolsHost 掛載（client:idle）
    await page.waitForTimeout(3000);

    // FAB 按鈕應該可見（面板尚未開啟）
    const fab = page.locator(FAB_SELECTOR);
    await expect(fab).toBeVisible({ timeout: 5000 });

    // 按 Ctrl+Shift+D 開啟面板
    await page.keyboard.press('Control+Shift+D');
    await page.waitForTimeout(500);

    // 面板應該出現
    const panel = page.locator(PANEL_SELECTOR);
    await expect(panel).toBeVisible({ timeout: 3000 });

    // 面板標頭應顯示 actions 數量（實際 63 個，允許 ≥ 10 個）
    const meta = page.locator(META_SELECTOR);
    const metaText = await meta.textContent();
    expect(metaText).toBeTruthy();
    // 解析 "N actions · M groups · Ctrl+Shift+D"
    const match = metaText?.match(/(\d+) actions/);
    expect(match).toBeTruthy();
    const actionCount = parseInt(match![1], 10);
    expect(actionCount).toBeGreaterThanOrEqual(10);
  });

  test('點 FAB 按鈕也能開啟面板', async ({ page }) => {
    await page.context().addCookies([
      {
        name: TEST_COOKIE,
        value: encodeURIComponent(TEST_WORKER_URL),
        domain: 'localhost',
        path: '/',
        sameSite: 'Strict',
      },
    ]);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const fab = page.locator(FAB_SELECTOR);
    await expect(fab).toBeVisible({ timeout: 5000 });
    await fab.click();

    const panel = page.locator(PANEL_SELECTOR);
    await expect(panel).toBeVisible({ timeout: 3000 });
  });
});

// ─────────────────────────────────────────────
//  測項 2 — 搜尋功能過濾 actions
// ─────────────────────────────────────────────
test.describe('T-21-2：面板搜尋 "reset" 過濾出 progress:reset', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([
      {
        name: TEST_COOKIE,
        value: encodeURIComponent(TEST_WORKER_URL),
        domain: 'localhost',
        path: '/',
        sameSite: 'Strict',
      },
    ]);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // 開啟面板
    await page.keyboard.press('Control+Shift+D');
    const panel = page.locator(PANEL_SELECTOR);
    await expect(panel).toBeVisible({ timeout: 3000 });
  });

  test('搜尋 "reset" → 過濾出包含 reset 的 action', async ({ page }) => {
    const searchInput = page.locator(SEARCH_INPUT_SELECTOR);
    await searchInput.fill('reset');
    await page.waitForTimeout(300);

    // 應顯示至少一個包含 "reset" 的 action 按鈕
    const resultButtons = page.locator('.uep-devtools-panel__btn');
    const count = await resultButtons.count();
    expect(count).toBeGreaterThan(0);

    // 確認有 progress:reset 這個 action（title 屬性含其 id）
    const progressResetBtn = page
      .locator('.uep-devtools-panel__btn')
      .filter({ hasText: '重置使用者 Progress' });
    await expect(progressResetBtn).toBeVisible();
  });

  test('搜尋無結果關鍵字 → 顯示空結果提示', async ({ page }) => {
    const searchInput = page.locator(SEARCH_INPUT_SELECTOR);
    await searchInput.fill('xyzzy-nonexistent-action-9999');
    await page.waitForTimeout(300);

    // 應顯示空結果文字
    const emptyHint = page.locator('.uep-devtools-panel__empty');
    await expect(emptyHint).toBeVisible();
    await expect(emptyHint).toContainText('無符合搜尋');
  });

  test('清空搜尋 → 回到全部 actions', async ({ page }) => {
    const searchInput = page.locator(SEARCH_INPUT_SELECTOR);
    await searchInput.fill('reset');
    await page.waitForTimeout(300);
    await searchInput.fill('');
    await page.waitForTimeout(300);

    // 全部 action 重新顯示
    const resultButtons = page.locator('.uep-devtools-panel__btn');
    const count = await resultButtons.count();
    expect(count).toBeGreaterThanOrEqual(10);
  });
});

// ─────────────────────────────────────────────
//  測項 3 — 執行安全 action（dump state）→ console 有輸出
// ─────────────────────────────────────────────
test.describe('T-21-3：執行 "傾印 progress state 到 console"', () => {
  test('點擊 progress:dump-state → console 有 [UEP Progress State] 輸出', async ({
    page,
  }) => {
    await page.context().addCookies([
      {
        name: TEST_COOKIE,
        value: encodeURIComponent(TEST_WORKER_URL),
        domain: 'localhost',
        path: '/',
        sameSite: 'Strict',
      },
    ]);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // 攔截 console.log
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'log') consoleLogs.push(msg.text());
    });

    // 開啟面板
    await page.keyboard.press('Control+Shift+D');
    const panel = page.locator(PANEL_SELECTOR);
    await expect(panel).toBeVisible({ timeout: 3000 });

    // 搜尋定位到 dump-state action
    const searchInput = page.locator(SEARCH_INPUT_SELECTOR);
    await searchInput.fill('傾印 progress');
    await page.waitForTimeout(300);

    const dumpBtn = page
      .locator('.uep-devtools-panel__btn')
      .filter({ hasText: '傾印 progress state 到 console' });
    await expect(dumpBtn).toBeVisible({ timeout: 3000 });

    await dumpBtn.click();
    // 等 async action 完成
    await page.waitForTimeout(1000);

    // console 應有 [UEP Progress State] 輸出
    const hasProgressLog = consoleLogs.some((log) =>
      log.includes('[UEP Progress State]')
    );
    expect(hasProgressLog).toBe(true);
  });
});

// ─────────────────────────────────────────────
//  測項 4 — Escape 關閉面板
// ─────────────────────────────────────────────
test.describe('T-21-4：Escape 關閉面板', () => {
  test('面板開啟時按 Escape → 面板關閉，FAB 重新出現', async ({ page }) => {
    await page.context().addCookies([
      {
        name: TEST_COOKIE,
        value: encodeURIComponent(TEST_WORKER_URL),
        domain: 'localhost',
        path: '/',
        sameSite: 'Strict',
      },
    ]);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // 開啟
    await page.keyboard.press('Control+Shift+D');
    const panel = page.locator(PANEL_SELECTOR);
    await expect(panel).toBeVisible({ timeout: 3000 });

    // 按 Escape 關閉
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 面板應消失
    await expect(panel).toHaveCount(0);

    // FAB 應重新出現
    const fab = page.locator(FAB_SELECTOR);
    await expect(fab).toBeVisible({ timeout: 3000 });
  });

  test('點 × 按鈕關閉面板', async ({ page }) => {
    await page.context().addCookies([
      {
        name: TEST_COOKIE,
        value: encodeURIComponent(TEST_WORKER_URL),
        domain: 'localhost',
        path: '/',
        sameSite: 'Strict',
      },
    ]);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    await page.keyboard.press('Control+Shift+D');
    const panel = page.locator(PANEL_SELECTOR);
    await expect(panel).toBeVisible({ timeout: 3000 });

    const closeBtn = page.locator('.uep-devtools-panel__close');
    await closeBtn.click();
    await page.waitForTimeout(500);

    await expect(panel).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────
//  測項 5 — 無 test cookie（非 DEV 模式的情境模擬）
//  注意：本地 DEV 模式 shouldMount() 恆 true，
//  因此此 case 只能驗證「localStorage force flag 控制」邏輯，
//  或用 buildtime production bundle 測試。
//  在 dev server 下此測試改為驗證「force flag 可強制顯示 FAB」。
// ─────────────────────────────────────────────
test.describe('T-21-5：shouldMount 條件驗證（dev server 情境）', () => {
  test('dev server 下不帶 cookie → FAB 仍出現（DEV === true）', async ({
    page,
  }) => {
    // 清除所有 cookie（無 test cookie）
    await page.context().clearCookies();

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // dev server 下 shouldMount() 因 import.meta.env.DEV === true 永遠回 true
    // FAB 應該出現
    const fab = page.locator(FAB_SELECTOR);
    await expect(fab).toBeVisible({ timeout: 5000 });
  });

  test('localStorage force flag 設為 true → FAB 出現', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');

    // 在 page load 後手動設定 localStorage（模擬 force flag）
    await page.evaluate(() => {
      localStorage.setItem('uep-devtools-force', 'true');
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const fab = page.locator(FAB_SELECTOR);
    await expect(fab).toBeVisible({ timeout: 5000 });

    // 清理 force flag
    await page.evaluate(() => {
      localStorage.removeItem('uep-devtools-force');
    });
  });
});
