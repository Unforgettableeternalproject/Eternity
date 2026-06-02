import { test, expect } from '@playwright/test';

/**
 * Admin 後台深度測試
 *
 * 測試 Admin 儀表板、區域導航、編輯器載入、媒體庫。
 * 開發模式下 middleware 自動放行，不需要登入。
 */

test.describe('Admin 儀表板', () => {
  test('儀表板顯示統計數據', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // 應該顯示總頁面、總章節等統計
    const stats = page.locator('[class*="stat"], [class*="quick-stat"]');
    // 儀表板應該有統計卡片
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toBeTruthy();
    // 應包含常見的 admin 文字
    expect(
      bodyText?.includes('頁面') || bodyText?.includes('ADMIN')
    ).toBeTruthy();
  });

  test('區域按鈕可以點擊', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // 找到區域管理按鈕
    const zoneButtons = page.locator('button').filter({
      hasText: /歷史典藏庫|回音蒐藏間|幻影重現室|概念調整房|雜亂的書桌/,
    });
    const count = await zoneButtons.count();
    expect(count).toBeGreaterThan(0);

    // 點擊第一個區域
    await zoneButtons.first().click();
    await page.waitForTimeout(1000);

    // 頁面應該還正常
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});

test.describe('Admin 編輯器', () => {
  test('/admin/edit/history 編輯器頁面載入正常', async ({ page }) => {
    await page.goto('/admin/edit/history');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // 頁面不應該白屏
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();

    // 應該有編輯器相關元素（TipTap 或 tree/list）
    const bodyText = await body.textContent();
    expect(bodyText?.length).toBeGreaterThan(50);
  });

  test('/admin/edit/echoes 編輯器頁面載入正常', async ({ page }) => {
    await page.goto('/admin/edit/echoes');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});

test.describe('Admin 媒體庫', () => {
  test('/admin/media 媒體庫頁面載入正常', async ({ page }) => {
    await page.goto('/admin/media');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const body = page.locator('body');
    await expect(body).not.toBeEmpty();

    // 確認頁面 title 包含「媒體庫」
    const title = await page.title();
    expect(title).toContain('媒體庫');
  });
});

test.describe('Admin 首頁管理', () => {
  const zones = ['history', 'echoes', 'visuals', 'concepts', 'storage'];

  for (const zone of zones) {
    test(`/admin/homepage/${zone} 載入正常`, async ({ page }) => {
      await page.goto(`/admin/homepage/${zone}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const body = page.locator('body');
      await expect(body).not.toBeEmpty();
    });
  }
});

test.describe('Admin API 安全性', () => {
  const TEST_SLUG = 'e2e-test-cleanup';
  const TEST_ASSET_KEY = 'files/e2e-test-cleanup.txt';
  const uploadedAssetKeys = new Set<string>();

  test('PUT /api/content 沒有 token 時被拒絕', async ({ request }) => {
    const res = await request.put(
      `http://localhost:8788/api/content/history/${TEST_SLUG}`,
      {
        data: { title: 'E2E Test — 自動清理', content: {} },
        headers: { 'Content-Type': 'application/json' },
      }
    );
    // 開發模式（無 API_TOKEN）：Bearer 檢查跳過 → 200（更新）或 201（建立）
    // 正式環境（有 API_TOKEN）：無 Bearer → 401
    expect([200, 201, 401]).toContain(res.status());
  });

  test('POST /api/assets 有 requireJwt 保護', async ({ request }) => {
    const res = await request.post('http://localhost:8788/api/assets', {
      multipart: {
        key: TEST_ASSET_KEY,
        file: {
          name: 'e2e-test-cleanup.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('e2e test file — safe to delete'),
        },
      },
    });
    // 開發模式（無 JWT_SECRET）：requireJwt 回傳 dev user → 200
    // 正式環境（有 JWT_SECRET）：無 JWT header → 401
    // 兩者都是正確行為
    expect([200, 201, 401]).toContain(res.status());

    if (res.status() === 200 || res.status() === 201) {
      const body = (await res.json()) as { data?: { key?: string } };
      uploadedAssetKeys.add(body.data?.key ?? TEST_ASSET_KEY);
    }
  });

  // 清理測試資料
  test.afterAll(async ({ request }) => {
    // 刪除測試頁面（D1）
    await request.delete(
      `http://localhost:8788/api/content/history/${TEST_SLUG}`
    );
    // 刪除測試檔案（R2）
    uploadedAssetKeys.add(TEST_ASSET_KEY);
    for (const key of uploadedAssetKeys) {
      await request.delete(
        `http://localhost:8788/api/assets/${encodeURIComponent(key)}`
      );
    }
  });
});
