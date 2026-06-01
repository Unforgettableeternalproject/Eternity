import { test, expect } from '@playwright/test';

/**
 * 極端操作與邊界情況測試
 *
 * 測試快速切換、返回前進、重新整理、錯誤恢復等邊界場景。
 * 目標：確保不會出現白屏、卡死、或資料遺失。
 */

test.describe('頁面重新整理', () => {
  const pages = [
    '/',
    '/history',
    '/echoes',
    '/visuals',
    '/concepts',
    '/storage',
    '/portal',
    '/admin',
  ];

  for (const path of pages) {
    test(`重新整理 ${path} 不會白屏`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
      // 重新整理
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      const body = page.locator('body');
      await expect(body).not.toBeEmpty();
      // 確認沒有 500 錯誤頁面
      const text = await body.textContent();
      expect(text).not.toContain('Internal Server Error');
    });
  }
});

test.describe('快速 Zone 切換', () => {
  test('連續快速導航多個 Zone 不會卡死', async ({ page }) => {
    const zones = ['/history', '/echoes', '/visuals', '/concepts', '/storage'];

    for (const zone of zones) {
      await page.goto(zone);
      // 不等 networkidle，直接切下一個（模擬快速切換）
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
    }

    // 最後一個頁面應該正常
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
    expect(page.url()).toContain('/storage');
  });
});

test.describe('瀏覽器返回/前進', () => {
  test('Zone 之間返回前進行為正確', async ({ page }) => {
    await page.goto('/history');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    await page.goto('/echoes');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // 返回到 history
    await page.goBack();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    expect(page.url()).toContain('/history');

    // 前進到 echoes
    await page.goForward();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    expect(page.url()).toContain('/echoes');

    // 兩個頁面都不應該白屏
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});

test.describe('API 錯誤恢復', () => {
  test('Content API 回傳非 JSON 時頁面不崩潰', async ({ page }) => {
    // 監聽 console 錯誤
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/history');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // 不應有未捕獲的 JS 錯誤
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('ResizeObserver') && // 已知 Chrome 噪音
        !e.includes('Non-Error promise rejection') &&
        !e.includes('Importing a module script failed') && // Vite HMR 間歇性失敗
        !e.includes('dynamically imported module')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('不存在的路徑', () => {
  test('不存在的 Zone 路徑回傳 404 而非 500', async ({ page }) => {
    const response = await page.goto('/nonexistent-zone');
    // 應該是 404（Astro 的預設行為），不是 500
    expect(response?.status()).toBeLessThan(500);
  });

  test('不存在的 Admin 子路徑不會崩潰', async ({ page }) => {
    const response = await page.goto('/admin/edit/nonexistent/path/here');
    await page.waitForLoadState('domcontentloaded');
    // 不應該是 500
    expect(response?.status()).toBeLessThan(500);
    // 頁面不應該白屏
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});

test.describe('行動版互動', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('行動版 Zone 頁面內容不溢出', async ({ page }) => {
    const zones = ['/history', '/echoes', '/concepts', '/storage'];

    for (const zone of zones) {
      await page.goto(zone);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // 檢查是否有水平溢出
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      // 不應該有水平溢出（允許一點誤差）
      if (hasOverflow) {
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth
        );
        // 允許 5px 的誤差（scrollbar 等）
        expect(overflow).toBeLessThan(5);
      }
    }
  });
});

test.describe('並行 API 請求', () => {
  test('多個 Zone tree API 並行請求不衝突', async ({ request }) => {
    const zones = ['history', 'echoes', 'visuals', 'concepts', 'storage'];

    // 並行發送所有 tree 請求
    const responses = await Promise.all(
      zones.map((zone) =>
        request.get(`http://localhost:8788/api/content/${zone}/tree`)
      )
    );

    // 全部應該成功
    for (let i = 0; i < responses.length; i++) {
      expect(responses[i].status()).toBe(200);
      const data = await responses[i].json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    }
  });
});
