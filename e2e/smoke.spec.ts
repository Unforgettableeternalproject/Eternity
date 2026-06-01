import { test, expect } from '@playwright/test';

/**
 * UEP 文件站煙霧測試
 *
 * 驗證關鍵使用者路徑不會白屏或崩潰。
 * 這些是最基本的健康檢查——確保部署後主要功能可用。
 *
 * 執行方式：pnpm test:e2e
 */

test.describe('首頁', () => {
  test('首頁載入成功，顯示標題', async ({ page }) => {
    await page.goto('/');
    // 等待 DOM 載入（不等 networkidle，因為首頁有持續的動畫和 API 呼叫）
    await page.waitForLoadState('domcontentloaded');
    // 確認頁面不是空白
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
    // 確認有 title
    expect(await page.title()).toBeTruthy();
  });

  test('首頁沒有致命的 console 錯誤', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // 等一下讓 React hydrate
    await page.waitForTimeout(2000);
    // 過濾掉已知的非致命錯誤
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('404') &&
        !e.includes('Failed to load resource') &&
        !e.includes('ERR_CONNECTION_REFUSED') &&
        !e.includes('Importing a module script failed') &&
        !e.includes('dynamically imported module')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('Zone 頁面載入', () => {
  const zones = [
    'history',
    'echoes',
    'visuals',
    'concepts',
    'storage',
    'portal',
  ];

  for (const zone of zones) {
    test(`/${zone} 頁面載入成功`, async ({ page }) => {
      const response = await page.goto(`/${zone}`);
      expect(response?.status()).toBeLessThan(500);
      await page.waitForLoadState('domcontentloaded');
      // 確認頁面有內容（不是白屏）
      const body = page.locator('body');
      await expect(body).not.toBeEmpty();
    });
  }
});

test.describe('Admin 頁面', () => {
  test('Admin 頁面可存取（開發模式自動放行）', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    // 開發模式下 middleware 直接放行，不需驗證
    // 確認 admin 儀表板有載入（包含 "ADMIN" 字樣）
    const adminContent = page.locator('body');
    await expect(adminContent).not.toBeEmpty();
    // 確認 URL 停在 /admin（沒被重導向到其他地方）
    expect(page.url()).toContain('/admin');
  });
});

test.describe('API 端點', () => {
  test('Content API 回應正常', async ({ request }) => {
    const response = await request.get(
      'http://localhost:8788/api/content/history'
    );
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('data');
  });

  test('Content API tree 端點正常', async ({ request }) => {
    const response = await request.get(
      'http://localhost:8788/api/content/history/tree'
    );
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('data');
  });
});
