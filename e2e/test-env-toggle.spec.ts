import { test, expect, type Page } from '@playwright/test';

/**
 * T-14 — Test Mode Banner + AdminTestModeControl E2E 測試
 *
 * 涵蓋範圍：
 * 1. Cookie override 生效：JS 直接寫入 cookie → banner 出現
 * 2. Admin toggle 切換：進入 test mode → banner 顯示 + cookie 寫入
 * 3. Admin toggle 退出：退出 test mode → banner 消失 + cookie 清除
 *
 * T-14-4 / T-14-5：Reset section RESET TEST 輸入確認流程
 * （commit 11326c5 補上 admin reset UI 後補測）。
 * Reset UI 用輸入框當 confirm gate（不用 window.confirm），只有輸入
 * `RESET TEST`（case-sensitive）才 enable 按鈕；按下直接 fetch，
 * 無需再確認 dialog。
 *
 * 注意：
 * - dev server 已在背景運行，playwright.config.ts 的 reuseExistingServer: true 會重用
 * - dev mode 下 admin middleware bypass，不需登入
 * - 二次確認使用站內 `.uep-dialog`，不再攔截瀏覽器原生 dialog
 */

const TEST_COOKIE = 'uep-test-api-url';
const TEST_WORKER_URL =
  'https://eternity-content-api-test.ptyc4076.workers.dev';

/**
 * 本地 dev 下帶 test cookie 進 /admin 會被 middleware 導去真登入
 * （`middleware.ts` 的 isTestModeDev 分支——test worker 會驗簽章、
 * 沒有 dev bypass，所以 SSR proxy 需要轉發真 JWT）。
 * 那道守門只檢查 cookie **存在**、不驗內容，測試補一個佔位值即可進頁面。
 *
 * ⚠️ 沒有這個 cookie 的話，所有「預設 test cookie 再進 admin」的案例
 * 都會停在登入頁，症狀是找不到卡片上的任何按鈕。
 */
const ADMIN_JWT_COOKIE = 'uep-admin-jwt';

/** test mode + 已登入的 cookie 組合（進 /admin 操作卡片用） */
const testModeAdminCookies = [
  {
    name: TEST_COOKIE,
    value: encodeURIComponent(TEST_WORKER_URL),
    domain: 'localhost',
    path: '/',
    sameSite: 'Strict' as const,
  },
  {
    name: ADMIN_JWT_COOKIE,
    value: 'e2e-dev-placeholder',
    domain: 'localhost',
    path: '/',
    sameSite: 'Strict' as const,
  },
];

/**
 * 讀取 cookie 值（包含 encodeURIComponent 的結果）。
 * Playwright 的 context.cookies() 只回傳未解碼值。
 */
async function getTestCookieRaw(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies('http://localhost:4321');
  const c = cookies.find((c) => c.name === TEST_COOKIE);
  return c?.value ?? null;
}

/**
 * 清除測試 cookie，讓每個 case 從乾淨狀態開始。
 */
async function clearTestCookie(page: Page): Promise<void> {
  await page.context().clearCookies();
}

// ─────────────────────────────────────────────
//  測項 1 — Cookie override 生效 → banner 出現
// ─────────────────────────────────────────────
test.describe('T-14-1：Cookie override 讓 banner 出現', () => {
  test('JS 寫入合法 test cookie 後重載 → banner 出現在 body 頂端', async ({
    page,
  }) => {
    await clearTestCookie(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // 直接用 addCookies 注入（不依賴 JS set，更可靠）
    await page.context().addCookies([
      {
        name: TEST_COOKIE,
        value: encodeURIComponent(TEST_WORKER_URL),
        domain: 'localhost',
        path: '/',
        sameSite: 'Strict',
      },
    ]);

    // 重載讓 banner React component client:load 重新 hydrate
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // 等待 React hydrate
    await page.waitForTimeout(1500);

    // banner 應該存在
    const banner = page.locator('.uep-test-mode-banner');
    await expect(banner).toBeVisible({ timeout: 5000 });

    // banner 包含 "TEST MODE" 文字
    await expect(banner).toContainText('TEST MODE');

    // body 有 has-test-banner class（banner 的副作用）
    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).toContain('has-test-banner');
  });

  test('Cookie 為非法 URL 時 banner 不出現', async ({ page }) => {
    await clearTestCookie(page);
    await page.context().addCookies([
      {
        name: TEST_COOKIE,
        // 不合法的 test worker URL
        value: encodeURIComponent('https://malicious.example.com'),
        domain: 'localhost',
        path: '/',
        sameSite: 'Strict',
      },
    ]);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    const banner = page.locator('.uep-test-mode-banner');
    await expect(banner).toHaveCount(0);
  });

  test('無 cookie 時 banner 不出現', async ({ page }) => {
    await clearTestCookie(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    const banner = page.locator('.uep-test-mode-banner');
    await expect(banner).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────
//  測項 2 — Admin toggle 切換到 test mode
// ─────────────────────────────────────────────
test.describe('T-14-2：Admin toggle 進入測試環境', () => {
  test.beforeEach(async ({ page }) => {
    await clearTestCookie(page);
  });

  test('點擊「切換到測試環境」→ Dialog 確認 → banner 出現 + cookie 寫入', async ({
    page,
  }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000); // 等 React hydrate

    // 找 AdminTestModeControl 中的按鈕
    const enterBtn = page
      .locator('.adm-test-mode-card__btn--enter')
      .filter({ hasText: '切換到測試環境' });
    await expect(enterBtn).toBeVisible({ timeout: 5000 });

    await enterBtn.click();
    const dialog = page.locator('.uep-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('切換測試環境');

    // 站內 Dialog 確認後會 reload
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => {
        // reload 後 URL 不變，waitForNavigation 可能以 timeout 結束
      }),
      dialog.locator('.uep-dialog__btn--confirm').click(),
    ]);

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // cookie 應該已寫入
    const rawCookie = await getTestCookieRaw(page);
    expect(rawCookie).toBeTruthy();
    const decoded = decodeURIComponent(rawCookie!);
    expect(decoded).toContain('eternity-content-api-test');

    // banner 應該出現
    const banner = page.locator('.uep-test-mode-banner');
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toContainText('TEST MODE');
  });

  test('點擊「切換到測試環境」→ Dialog 取消 → cookie 沒寫入', async ({
    page,
  }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const enterBtn = page.locator('.adm-test-mode-card__btn--enter');
    await expect(enterBtn).toBeVisible({ timeout: 5000 });

    await enterBtn.click();
    const dialog = page.locator('.uep-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('.uep-dialog__btn--cancel').click();
    // 短暫等待（不應 reload）
    await page.waitForTimeout(1000);

    const rawCookie = await getTestCookieRaw(page);
    expect(rawCookie).toBeNull();
  });
});

// ─────────────────────────────────────────────
//  測項 3 — Admin toggle 退出 test mode
// ─────────────────────────────────────────────
test.describe('T-14-3：Admin toggle 退出測試環境', () => {
  test('帶 test cookie 進 admin → 點「退出測試環境」→ Dialog 確認 → cookie 清除 + banner 消失', async ({
    page,
  }) => {
    // 先設好 cookie
    await page.context().addCookies(testModeAdminCookies);

    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // 應該看到退出按鈕（已在 test mode）
    const exitBtn = page.locator('.adm-test-mode-card__btn--exit');
    await expect(exitBtn).toBeVisible({ timeout: 5000 });

    await exitBtn.click();
    const dialog = page.locator('.uep-dialog');
    await expect(dialog).toBeVisible();
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
      dialog.locator('.uep-dialog__btn--confirm').click(),
    ]);

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // cookie 應該已清除
    const rawCookie = await getTestCookieRaw(page);
    expect(rawCookie).toBeNull();

    // banner 應該消失
    const banner = page.locator('.uep-test-mode-banner');
    await expect(banner).toHaveCount(0);
  });

  test('帶 test cookie 進 admin → 點退出 → Dialog 取消 → cookie 仍存在', async ({
    page,
  }) => {
    await page.context().addCookies(testModeAdminCookies);

    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const exitBtn = page.locator('.adm-test-mode-card__btn--exit');
    await expect(exitBtn).toBeVisible({ timeout: 5000 });

    await exitBtn.click();
    const dialog = page.locator('.uep-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('.uep-dialog__btn--cancel').click();
    await page.waitForTimeout(1000);

    // cookie 應該還在
    const rawCookie = await getTestCookieRaw(page);
    expect(rawCookie).toBeTruthy();
  });
});

// ─────────────────────────────────────────────
//  測項 4 — Reset 輸入不匹配 → 按鈕 disabled，不觸發 fetch
// ─────────────────────────────────────────────
test.describe('T-14-4：Reset 輸入未匹配 → 按鈕 disabled', () => {
  test('輸入非 RESET TEST 的字串 → 按鈕保持 disabled → 沒有 API 呼叫', async ({
    page,
  }) => {
    // 攔截並計數 POST /api/test/reset
    let resetCalls = 0;
    await page.route('**/api/test/reset', (route) => {
      resetCalls += 1;
      // 拒絕請求（若真的被打到會計數但不會實際打到 test worker）
      route.abort();
    });

    // 進入 test mode（cookie 觸發，才會顯示 reset section）
    await clearTestCookie(page);
    await page.context().addCookies(testModeAdminCookies);

    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // reset section 應該存在（因為 inTestMode && source==='cookie'）
    const resetSection = page.locator('.adm-test-mode-card__reset-section');
    await expect(resetSection).toBeVisible({ timeout: 5000 });

    const input = page.locator('.adm-test-mode-card__reset-input');
    const resetBtn = page.locator('.adm-test-mode-card__btn--reset');

    // 初始 disabled
    await expect(resetBtn).toBeDisabled();

    // 輸入錯誤字串
    await input.fill('reset test'); // 小寫，不匹配
    await expect(resetBtn).toBeDisabled();

    await input.fill('RESET_TEST'); // 底線，不匹配
    await expect(resetBtn).toBeDisabled();

    await input.fill('RESET TESTX'); // 尾部多字，不匹配
    await expect(resetBtn).toBeDisabled();

    // 嘗試點擊 disabled 按鈕不會觸發 handler
    await resetBtn.click({ force: true }).catch(() => {
      /* 按鈕 disabled 時 click 可能被拒，忽略錯誤 */
    });
    await page.waitForTimeout(500);

    // 確認沒有 fetch 到 reset endpoint
    expect(resetCalls).toBe(0);
  });
});

// ─────────────────────────────────────────────
//  測項 5 — Reset 輸入 RESET TEST → 按鈕 enabled → 觸發 POST /api/test/reset
// ─────────────────────────────────────────────
test.describe('T-14-5：Reset 輸入匹配 → 按鈕 enabled → 呼叫 API', () => {
  test('輸入 RESET TEST → 按鈕 enable → click 觸發 POST /api/test/reset', async ({
    page,
  }) => {
    // 攔截並 mock reset response，避免真的打到 test worker
    let resetCallCount = 0;
    let requestMethod = '';
    await page.route('**/api/test/reset', (route) => {
      resetCallCount += 1;
      requestMethod = route.request().method();
      // Mock 200 response
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            tables: ['pages', 'root_projects'],
            totalRows: 42,
            clearedAt: new Date().toISOString(),
            seeded: { pages: 96 },
          },
        }),
      });
    });

    // 進入 test mode
    await clearTestCookie(page);
    await page.context().addCookies(testModeAdminCookies);

    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const input = page.locator('.adm-test-mode-card__reset-input');
    const resetBtn = page.locator('.adm-test-mode-card__btn--reset');

    // 輸入完整字串
    await input.fill('RESET TEST');
    await expect(resetBtn).toBeEnabled();

    // 點擊執行 reset
    await resetBtn.click();

    // 等待 fetch 完成 + UI 更新
    await page.waitForTimeout(2000);

    // 應該打了一次 POST
    expect(resetCallCount).toBe(1);
    expect(requestMethod).toBe('POST');

    // 成功訊息應顯示（.adm-test-mode-card__reset-msg--ok）
    const okMsg = page.locator('.adm-test-mode-card__reset-msg--ok');
    await expect(okMsg).toBeVisible({ timeout: 3000 });
    await expect(okMsg).toContainText('清除');
    await expect(okMsg).toContainText('42');
    await expect(okMsg).toContainText('重新建立 96 個頁面骨架');

    // 輸入框應該被清空
    await expect(input).toHaveValue('');
  });
});
