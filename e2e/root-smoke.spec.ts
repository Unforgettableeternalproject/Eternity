import { test, expect } from '@playwright/test';

/**
 * 主站煙霧測試
 *
 * 驗證主站（Quartz 設計系統）各頁面載入正常、不白屏、不崩潰。
 * baseURL 透過 project config 指向 localhost:4320。
 */

// 所有測試使用主站 baseURL
test.use({ baseURL: 'http://localhost:4320' });

test.describe('主站首頁', () => {
  test('首頁載入成功', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
    expect(await page.title()).toBeTruthy();
  });

  test('首頁沒有致命 console 錯誤', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('404') &&
        !e.includes('Failed to load resource') &&
        !e.includes('ERR_CONNECTION_REFUSED')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('主站頁面載入', () => {
  const pages = [
    { path: '/about', label: 'About' },
    { path: '/projects', label: 'Projects' },
    { path: '/updates', label: 'Updates' },
    { path: '/links', label: 'Links' },
    { path: '/contact', label: 'Contact' },
    { path: '/console', label: 'Console' },
  ];

  for (const { path, label } of pages) {
    test(`${label} (${path}) 載入成功`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(500);
      await page.waitForLoadState('domcontentloaded');

      const body = page.locator('body');
      await expect(body).not.toBeEmpty();
    });
  }
});

test.describe('主站英文版', () => {
  test('/en 首頁載入成功', async ({ page }) => {
    const response = await page.goto('/en');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });

  test('/en/about 載入成功', async ({ page }) => {
    const response = await page.goto('/en/about');
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('domcontentloaded');

    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});

test.describe('主站 API 端點', () => {
  test('搜尋 API 回傳可搜尋資料', async ({ request }) => {
    const res = await request.get('/api/search-zh-tw.json');
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data.some((item: { id?: string }) => item.id === 'page-home')).toBe(
      true
    );
  });

  test('Contact API 缺少必填欄位時回傳 400', async ({ request }) => {
    const res = await request.post('/api/contact.json', {
      data: { name: 'E2E', email: 'e2e@example.com' },
    });
    expect(res.status()).toBe(400);

    const data = await res.json();
    expect(data.code).toBe('MISSING_FIELDS');
  });

  test('Contact API email 格式錯誤時回傳 400', async ({ request }) => {
    const res = await request.post('/api/contact.json', {
      data: {
        name: 'E2E',
        email: 'not-an-email',
        subject: 'invalid email',
        message: 'validation only',
      },
    });
    expect(res.status()).toBe(400);

    const data = await res.json();
    expect(data.code).toBe('INVALID_EMAIL');
  });

  test('Root Projects API 回應正常', async ({ request }) => {
    const res = await request.get('http://localhost:8788/api/root/projects');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('data');
  });

  test('Root Links API 回應正常', async ({ request }) => {
    const res = await request.get('http://localhost:8788/api/root/links');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('data');
  });

  test('Root Updates API 回應正常', async ({ request }) => {
    const res = await request.get('http://localhost:8788/api/root/updates');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('data');
  });

  test('Root Singletons API 回應正常', async ({ request }) => {
    // section_id 為 "about-zh"（非 "about"）
    const res = await request.get(
      'http://localhost:8788/api/root/singletons/about-zh'
    );
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.data).toHaveProperty('sectionId', 'about-zh');
  });
});

test.describe('主站頁面重新整理', () => {
  const pages = ['/', '/about', '/projects', '/updates', '/links', '/contact'];

  for (const path of pages) {
    test(`重新整理 ${path} 不會白屏`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      const body = page.locator('body');
      await expect(body).not.toBeEmpty();
      const text = await body.textContent();
      expect(text).not.toContain('Internal Server Error');
    });
  }
});

test.describe('主站不存在路徑', () => {
  test('不存在的路徑回傳 404 而非 500', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBeLessThan(500);
  });
});
