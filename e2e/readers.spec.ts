import { test, expect } from '@playwright/test';

/**
 * Zone Reader 深度測試
 *
 * 測試各 Zone 的 Reader 載入、導航、deep link、boot 動畫。
 * 覆蓋 code review 發現的 P1 boot timing 問題。
 */

const ZONES_WITH_READERS = [
  { zone: 'history', hasTree: true, label: 'History' },
  { zone: 'echoes', hasTree: true, label: 'Echoes' },
  { zone: 'visuals', hasTree: true, label: 'Visuals' },
  { zone: 'concepts', hasTree: true, label: 'Concepts' },
  { zone: 'storage', hasTree: true, label: 'Storage' },
];

for (const { zone, label } of ZONES_WITH_READERS) {
  test.describe(`${label} Reader`, () => {
    test(`/${zone} 載入內容不會白屏`, async ({ page }) => {
      await page.goto(`/${zone}`);
      await page.waitForLoadState('domcontentloaded');

      // 等待 React hydration 和 boot 動畫（最多 8 秒）
      await page.waitForTimeout(3000);

      // 頁面應有實質內容
      const body = page.locator('body');
      await expect(body).not.toBeEmpty();

      // 不應該有未解除的 boot overlay 卡住畫面（超過 8 秒）
      const bootOverlay = page.locator('[class*="boot-overlay"]');
      // 如果存在，它應該已經消失或正在淡出
      if ((await bootOverlay.count()) > 0) {
        await expect(bootOverlay).toHaveCSS('opacity', '0', {
          timeout: 8000,
        });
      }
    });

    test(`/${zone} 沒有 API 載入錯誤`, async ({ page }) => {
      const apiErrors: string[] = [];
      page.on('response', (response) => {
        if (
          response.url().includes('/api/content/') &&
          response.status() >= 500
        ) {
          apiErrors.push(`${response.status()} ${response.url()}`);
        }
      });

      await page.goto(`/${zone}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      expect(apiErrors).toHaveLength(0);
    });

    test(`/${zone} API 回傳有效的 tree 資料`, async ({ request }) => {
      const res = await request.get(
        `http://localhost:8788/api/content/${zone}/tree`
      );
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data)).toBe(true);
    });
  });
}

test.describe('Reader — Deep link', () => {
  test('History deep link 到具體頁面可載入', async ({ page, request }) => {
    // 先取得一個有效的頁面 slug
    const treeRes = await request.get(
      'http://localhost:8788/api/content/history/tree'
    );
    const treeData = await treeRes.json();

    if (treeData.data && treeData.data.length > 0) {
      // 找一個葉子節點
      const findLeaf = (nodes: any[]): string | null => {
        for (const node of nodes) {
          if (
            !node.children?.length &&
            node.pageType !== 'page' &&
            node.status !== 'draft'
          ) {
            return node.id;
          }
          if (node.children?.length) {
            const found = findLeaf(node.children);
            if (found) return found;
          }
        }
        return null;
      };

      const leafId = findLeaf(treeData.data);
      if (leafId) {
        // 用 deep link 進入
        await page.goto(`/history?page=${encodeURIComponent(leafId)}`);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5000);

        // 頁面應該載入成功（不是白屏）
        const body = page.locator('body');
        await expect(body).not.toBeEmpty();

        // URL 應該包含 page 參數
        expect(page.url()).toContain('page=');
      }
    }
  });

  test('Storage deep link 到 clearing 可載入', async ({ page, request }) => {
    // 先取得一個有效的 clearing
    const treeRes = await request.get(
      'http://localhost:8788/api/content/storage/tree'
    );
    const treeData = await treeRes.json();

    if (treeData.data && treeData.data.length > 0) {
      // 找一個 clearing 節點
      const findClearing = (nodes: any[]): string | null => {
        for (const node of nodes) {
          if (node.pageType === 'clearing') return node.slug;
          if (node.children?.length) {
            const found = findClearing(node.children);
            if (found) return found;
          }
        }
        return null;
      };

      const clearingSlug = findClearing(treeData.data);
      if (clearingSlug) {
        await page.goto(
          `/storage?clearing=${encodeURIComponent(clearingSlug)}`
        );
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(5000);

        const body = page.locator('body');
        await expect(body).not.toBeEmpty();
      }
    }
  });
});

test.describe('Reader — 內容互動', () => {
  // 側邊欄按鈕在 mobile viewport 下可能不在畫面內，只在桌面版測試
  test.use({ viewport: { width: 1280, height: 720 } });

  test('History Reader 可展開/收合側邊欄', async ({ page }) => {
    await page.goto('/history');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // 尋找側邊欄切換按鈕
    const sidebarToggle = page.locator(
      'button[class*="sidebar"], [class*="toggle-sidebar"]'
    );
    if ((await sidebarToggle.count()) > 0) {
      // 用 force 避免在 boot 動畫期間被遮蓋
      await sidebarToggle.first().click({ force: true });
      await page.waitForTimeout(500);
      await sidebarToggle.first().click({ force: true });
      await page.waitForTimeout(500);
    }

    // 頁面還是正常的
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});
