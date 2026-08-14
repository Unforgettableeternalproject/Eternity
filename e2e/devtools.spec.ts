import { test, expect, type Page } from '@playwright/test';

/**
 * T-21 — UepDevTools 命令面板 E2E 測試
 *
 * 快捷鍵：Ctrl+Shift+D
 *
 * shouldMount() 條件（三選一，**且必須是桌面視窗**）：
 *   0. 視窗寬度 ≥ 761px（useDesktopIslandViewport）——手機一律不掛
 *   1. isTestMode() === true（cookie 為合法 test worker URL）
 *   2. localStorage['uep-devtools-force'] === 'true'（強制開啟）
 *   3. import.meta.env.DEV === true（本地 dev server 永遠開）
 *
 * 本地 dev server 在 DEV === true 的條件下 shouldMount() 恆為 true，
 * 因此不帶 cookie 也能觸發面板。
 *
 * ⚠️ 條件 0 是 S11 A 段（`8b1e0c1`，0.9.18.1）加的：面板本身是三欄命令
 *    列表，在 390px 上不可用，而 FAB 會擋住右下角。守門擋在渲染層而非
 *    mount effect（effect 只跑一次，之後縮窗到手機寬度不會再 evaluate），
 *    所以 keydown 監聽仍在，但手機上按快捷鍵只會翻 open state，元件照樣
 *    回傳 null。下方主要測項限定桌面執行，手機的預期行為另有專屬測項驗證。
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

/** 掛載等待上限。dev server 在多 worker 並行下 hydration 可以拖很久。 */
const MOUNT_TIMEOUT = 20_000;

async function addTestCookie(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: TEST_COOKIE,
      value: encodeURIComponent(TEST_WORKER_URL),
      domain: 'localhost',
      path: '/',
      sameSite: 'Strict',
    },
  ]);
}

/**
 * 進首頁並等到 DevTools 真的掛好。
 *
 * 同步點取 FAB 而非固定睡眠：`UepDevTools.tsx` 的 mount effect 裡
 * `setMounted(true)` 與 `window.addEventListener('keydown')` 是同一段，
 * FAB 出現就代表快捷鍵監聽已註冊。睡固定秒數只是在賭 hydration 有沒有
 * 跑完——並行負載下賭輸就變成整組 flaky。
 */
async function gotoWithDevTools(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator(FAB_SELECTOR)).toBeVisible({
    timeout: MOUNT_TIMEOUT,
  });
}

/**
 * 等 DevTools 這座 island 完成 hydration（Astro 在 hydrate 後拿掉 `ssr` 屬性）。
 *
 * 專給「不該掛載」的負面斷言用：手機上 FAB 永遠不出現，沒有東西可以等，
 * 睡固定秒數的話 hydration 只要慢一點，斷言就會在元件還沒跑之前先通過——
 * 手機守門真的壞掉也照樣綠燈。
 */
async function waitForDevToolsIslandHydrated(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector(
            'astro-island[component-url*="UepDevTools"]'
          );
          return !!el && !el.hasAttribute('ssr');
        }),
      { timeout: MOUNT_TIMEOUT }
    )
    .toBe(true);
}

/** 進首頁 → 等掛載 → 用快捷鍵開面板 */
async function openPanelByShortcut(page: Page): Promise<void> {
  await gotoWithDevTools(page);
  await page.keyboard.press('Control+Shift+D');
  await expect(page.locator(PANEL_SELECTOR)).toBeVisible({ timeout: 5000 });
}

// ─────────────────────────────────────────────
//  測項 1 — 帶 test cookie 進 uep home → Ctrl+Shift+D → 面板出現
// ─────────────────────────────────────────────
test.describe('T-21-1：帶 test cookie → DevTools 面板開啟', () => {
  // DevTools 只在桌面掛載（見檔頭條件 0）；手機的預期行為由 T-21-6 驗證
  test.skip(
    ({ viewport }) => !!viewport && viewport.width <= 760,
    'DevTools 在 760px 以下刻意不掛載'
  );

  test('Ctrl+Shift+D 打開面板，顯示 actions 清單', async ({ page }) => {
    // 先注入 test cookie（讓 isTestMode() === true）
    await addTestCookie(page);
    await openPanelByShortcut(page);

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
    await addTestCookie(page);
    await gotoWithDevTools(page);

    await page.locator(FAB_SELECTOR).click();

    const panel = page.locator(PANEL_SELECTOR);
    await expect(panel).toBeVisible({ timeout: 5000 });
  });
});

// ─────────────────────────────────────────────
//  測項 2 — 搜尋功能過濾 actions
// ─────────────────────────────────────────────
test.describe('T-21-2：面板搜尋 "reset" 過濾出 progress:reset', () => {
  // DevTools 只在桌面掛載（見檔頭條件 0）；手機的預期行為由 T-21-6 驗證
  test.skip(
    ({ viewport }) => !!viewport && viewport.width <= 760,
    'DevTools 在 760px 以下刻意不掛載'
  );

  test.beforeEach(async ({ page }) => {
    await addTestCookie(page);
    await openPanelByShortcut(page);
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
  // DevTools 只在桌面掛載（見檔頭條件 0）；手機的預期行為由 T-21-6 驗證
  test.skip(
    ({ viewport }) => !!viewport && viewport.width <= 760,
    'DevTools 在 760px 以下刻意不掛載'
  );

  test('點擊 progress:dump-state → console 有 [UEP Progress State] 輸出', async ({
    page,
  }) => {
    await addTestCookie(page);
    await gotoWithDevTools(page);

    // 攔截 console.log
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'log') consoleLogs.push(msg.text());
    });

    // 開啟面板
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator(PANEL_SELECTOR)).toBeVisible({ timeout: 5000 });

    // 搜尋定位到 dump-state action
    const searchInput = page.locator(SEARCH_INPUT_SELECTOR);
    await searchInput.fill('傾印 progress');

    const dumpBtn = page
      .locator('.uep-devtools-panel__btn')
      .filter({ hasText: '傾印 progress state 到 console' });
    await expect(dumpBtn).toBeVisible({ timeout: 5000 });

    await dumpBtn.click();

    // action 是 async，輪詢等輸出而不是睡固定秒數
    await expect
      .poll(
        () => consoleLogs.some((log) => log.includes('[UEP Progress State]')),
        { timeout: 5000 }
      )
      .toBe(true);
  });
});

// ─────────────────────────────────────────────
//  測項 4 — Escape 關閉面板
// ─────────────────────────────────────────────
test.describe('T-21-4：Escape 關閉面板', () => {
  // DevTools 只在桌面掛載（見檔頭條件 0）；手機的預期行為由 T-21-6 驗證
  test.skip(
    ({ viewport }) => !!viewport && viewport.width <= 760,
    'DevTools 在 760px 以下刻意不掛載'
  );

  test('面板開啟時按 Escape → 面板關閉，FAB 重新出現', async ({ page }) => {
    await addTestCookie(page);
    await openPanelByShortcut(page);

    // 按 Escape 關閉
    await page.keyboard.press('Escape');

    // 面板應消失
    await expect(page.locator(PANEL_SELECTOR)).toHaveCount(0);

    // FAB 應重新出現
    await expect(page.locator(FAB_SELECTOR)).toBeVisible({ timeout: 5000 });
  });

  test('點 × 按鈕關閉面板', async ({ page }) => {
    await addTestCookie(page);
    await openPanelByShortcut(page);

    await page.locator('.uep-devtools-panel__close').click();

    await expect(page.locator(PANEL_SELECTOR)).toHaveCount(0);
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
  // DevTools 只在桌面掛載（見檔頭條件 0）；手機的預期行為由 T-21-6 驗證
  test.skip(
    ({ viewport }) => !!viewport && viewport.width <= 760,
    'DevTools 在 760px 以下刻意不掛載'
  );

  test('dev server 下不帶 cookie → FAB 仍出現（DEV === true）', async ({
    page,
  }) => {
    // 清除所有 cookie（無 test cookie）
    await page.context().clearCookies();

    // dev server 下 shouldMount() 因 import.meta.env.DEV === true 永遠回 true
    // FAB 應該出現
    await gotoWithDevTools(page);
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

    await expect(page.locator(FAB_SELECTOR)).toBeVisible({
      timeout: MOUNT_TIMEOUT,
    });

    // 清理 force flag
    await page.evaluate(() => {
      localStorage.removeItem('uep-devtools-force');
    });
  });
});

// ─────────────────────────────────────────────
//  測項 6 — 手機一律不掛 DevTools（S11 A 段，0.9.18.1）
//
//  這組與上方主測項互斥：上面 skip 掉手機，這裡只在手機跑。
//  之所以要正向斷言而不是單純跳過——手機不掛是**刻意的行為**，
//  它退化時應該有東西紅起來。此前這條規則上線三週都沒有任何測試守著。
// ─────────────────────────────────────────────
test.describe('T-21-6：手機視窗不掛載 DevTools', () => {
  test.skip(
    ({ viewport }) => !viewport || viewport.width > 760,
    '本組只驗證手機視窗'
  );

  test('帶 test cookie 也不出現 FAB，快捷鍵同樣沒有反應', async ({ page }) => {
    await addTestCookie(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await waitForDevToolsIslandHydrated(page);

    await expect(page.locator(FAB_SELECTOR)).toHaveCount(0);

    // 快捷鍵監聽本身有掛，但守門擋在渲染層——按下去只會翻 open state，
    // `!desktopViewport` 仍讓元件回傳 null，面板不會出現
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator(PANEL_SELECTOR)).toHaveCount(0);
  });

  test('force flag 也無法在手機上開啟', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('uep-devtools-force', 'true');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await waitForDevToolsIslandHydrated(page);

    await expect(page.locator(FAB_SELECTOR)).toHaveCount(0);

    await page.evaluate(() => {
      localStorage.removeItem('uep-devtools-force');
    });
  });
});
