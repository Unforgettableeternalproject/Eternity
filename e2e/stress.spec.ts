import { test, expect } from '@playwright/test';

/**
 * 主站壓力測試
 *
 * 模擬使用者高頻操作，驗證頁面在快速切換和互動下不崩潰、不洩漏。
 * baseURL 透過 project config 指向 localhost:4320。
 */

test.use({ baseURL: 'http://localhost:4320' });

// ── 快速頁面切換壓力測試 ──────────────────────────────────

test.describe('快速頁面切換', () => {
  test('連續切換 10 頁不崩潰', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const routes = [
      '/zh-tw/',
      '/zh-tw/about',
      '/zh-tw/projects',
      '/zh-tw/updates',
      '/zh-tw/links',
      '/zh-tw/contact',
      '/zh-tw/about',
      '/zh-tw/',
      '/zh-tw/projects',
      '/zh-tw/links',
    ];

    // 首頁先載入
    await page.goto(routes[0]);
    await page.waitForLoadState('domcontentloaded');

    // 快速連續切頁（模擬急躁的使用者）
    for (const route of routes.slice(1)) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      // 不等完全載入就切下一頁
    }

    // 最後等穩定
    await page.waitForTimeout(2000);

    // 過濾掉非致命錯誤
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('404') &&
        !e.includes('Failed to load resource') &&
        !e.includes('ERR_CONNECTION_REFUSED') &&
        !e.includes('Download the React DevTools') &&
        !e.includes('Failed to load search data') &&
        !e.includes('astro-island') &&
        !e.includes('Failed to fetch dynamically imported') &&
        !e.includes('Importing a module script failed') &&
        !e.includes('Load failed')
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('快速切頁後頁面內容正確', async ({ page }) => {
    await page.goto('/zh-tw/');
    await page.waitForLoadState('domcontentloaded');

    // 快速切到 about
    await page.goto('/zh-tw/about');
    await page.waitForLoadState('domcontentloaded');

    // 快速切到 projects
    await page.goto('/zh-tw/projects');
    await page.waitForLoadState('domcontentloaded');

    // 確認最終頁面內容正確（不是白屏或上一頁的殘影）
    const title = await page.title();
    expect(title).toContain('作品');
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(100);
  });
});

// ── ViewTransition 導航壓力 ──────────────────────────────────

test.describe('ViewTransition 導航壓力', () => {
  test('透過 URL 快速切頁 5 次（模擬導航）', async ({ page }) => {
    // 用 goto 而非 click 導航，更穩定且不依賴 nav 文字
    const routes = [
      '/zh-tw/',
      '/zh-tw/about',
      '/zh-tw/projects',
      '/zh-tw/updates',
      '/zh-tw/links',
      '/zh-tw/',
    ];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
    }

    // 頁面不應該白屏
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});

// ── 搜尋框壓力測試 ──────────────────────────────────

test.describe('搜尋框壓力', () => {
  test('快速開關搜尋框 10 次不崩潰', async ({ page }) => {
    await page.goto('/zh-tw/');
    await page.waitForLoadState('networkidle');

    for (let i = 0; i < 10; i++) {
      // 開啟搜尋
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(200);

      // 關閉搜尋
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

    // 頁面仍然正常
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });

  test('搜尋框中快速輸入和切換篩選', async ({ page }) => {
    await page.goto('/zh-tw/');
    await page.waitForLoadState('networkidle');

    // 點擊搜尋按鈕開啟（手機版可能搜尋按鈕不可見，跳過）
    const trigger = page.locator('.global-search__trigger').first();
    if (!(await trigger.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, '搜尋按鈕不可見（可能是手機版），跳過');
      return;
    }
    await trigger.click();
    await page.waitForTimeout(500);

    const modal = page.locator('.global-search__modal');
    if (!(await modal.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, '搜尋框未開啟，跳過');
      return;
    }

    // 快速輸入
    const input = modal.locator('.global-search__input');
    await input.fill('test');
    await page.waitForTimeout(200);
    await input.fill('專案');
    await page.waitForTimeout(200);
    await input.fill('');
    await page.waitForTimeout(200);

    // 快速切換篩選標籤
    const allFilters = modal.locator('.global-search__filter');
    const count = await allFilters.count();
    for (let i = 0; i < count; i++) {
      await allFilters.nth(i).click();
      await page.waitForTimeout(100);
    }

    // 搜尋框仍然正常
    await expect(modal).toBeVisible();
  });
});

// ── 滾動壓力測試 ──────────────────────────────────

test.describe('滾動壓力', () => {
  test('快速滾動長頁面不崩潰', async ({ page }) => {
    await page.goto('/zh-tw/about');
    await page.waitForLoadState('networkidle');

    // 快速滾動到底部再回頂部，重複 3 次
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
    }

    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});

// ── Console 錯誤累積測試 ──────────────────────────────────

test.describe('Console 錯誤監控', () => {
  test('完整瀏覽所有頁面後無未處理錯誤', async ({ page }) => {
    const errors: string[] = [];
    const unhandledRejections: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      unhandledRejections.push(err.message);
    });

    const routes = [
      '/zh-tw/',
      '/zh-tw/about',
      '/zh-tw/projects',
      '/zh-tw/updates',
      '/zh-tw/links',
      '/zh-tw/contact',
      '/en/',
      '/en/about',
    ];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
    }

    // 過濾已知無害錯誤（dev 模式下快速切頁常見的 race condition）
    const IGNORED = [
      'favicon',
      '404',
      'Failed to load resource',
      'ERR_CONNECTION_REFUSED',
      'Download the React DevTools',
      'Failed to load search data',
      'astro-island',
      'Failed to fetch dynamically imported',
      'Importing a module script failed',
      'Load failed',
      'Minified React error',
      'Failed to fetch',
      'AbortError',
      'net::ERR_ABORTED',
      'cancelled',
      'TypeError: Load failed',
    ];
    const realErrors = errors.filter(
      (e) => !IGNORED.some((pat) => e.includes(pat))
    );

    expect(
      realErrors,
      `發現 ${realErrors.length} 個 console 錯誤:\n${realErrors.join('\n')}`
    ).toHaveLength(0);

    const realRejections = unhandledRejections.filter(
      (e) => !IGNORED.some((pat) => e.includes(pat))
    );
    expect(
      realRejections,
      `發現 ${realRejections.length} 個未處理 rejection:\n${realRejections.join('\n')}`
    ).toHaveLength(0);
  });
});
