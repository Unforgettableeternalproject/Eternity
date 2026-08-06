#!/usr/bin/env node
/**
 * 前端效能量測 — 可重複、可比較的基準線
 *
 * ## 為什麼不直接看 PageSpeed 分數
 *
 * PageSpeed 每次跑會打到不同的 Cloudflare 邊緣節點，冷啟動與熱路徑的
 * TTFB 差了一個數量級（實測 2268ms vs 150ms）。同一份設定連續兩次量到的
 * FCP 是 8.4s 與 14.3s——**六秒的噪音**，遠大於任何單項優化的效果。
 * 拿那個數字當驗收標準，等於在擲骰子。
 *
 * 這支腳本固定節流參數、同一台機器連跑多次取**中位數**，用來回答
 * 「這次改動有沒有效」，而不是「我們拿幾分」。分數留給 PageSpeed。
 *
 * ## 用法
 *
 *   node scripts/perf-measure.mjs                        # 預設 staging 首頁 / mobile
 *   node scripts/perf-measure.mjs --profile=desktop
 *   node scripts/perf-measure.mjs --url=https://... --runs=5
 *   node scripts/perf-measure.mjs --json                 # 輸出 JSON 供前後對照
 *
 * ## 節流參數
 *
 * 對齊 Lighthouse 的 slow 4G：1.6Mbps 下載 / 750Kbps 上傳 / 150ms RTT，
 * CPU 4x 降速。桌面用 10Mbps / 40ms / 不降速。
 * ⚠️ 數值只在**同一組參數之間**可比較，不要拿來對照 PageSpeed 的絕對值。
 *
 * ## 已知限制
 *
 * - **字型量不準**：headless chromium 的字型載入策略與真實瀏覽器不同，
 *   CJK 分片常常一個都不抓，於是「字型 0 個」不代表優化生效。字型體積
 *   請用真實瀏覽器的 DevTools Network 面板確認。
 * - 跨網域資源沒有 Timing-Allow-Origin 時 `encodedBodySize` 恆為 0，
 *   所以大小欄位會顯示「不可見」而不是 0 KB——兩者意義完全不同。
 * - 量的是**初次載入**（每次開新 context），不反映回訪的快取效益。
 */

/* 從 @playwright/test 取用，不另裝 playwright——專案已有前者（e2e 用），
   多裝一個獨立的 playwright 只會讓兩份瀏覽器版本有機會漂移 */
import { chromium } from '@playwright/test';

const PROFILES = {
  mobile: {
    label: '行動裝置（slow 4G + CPU 4x）',
    viewport: { width: 390, height: 844 },
    network: {
      offline: false,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
      latency: 150,
    },
    cpuThrottling: 4,
  },
  desktop: {
    label: '桌面（10Mbps + 無 CPU 降速）',
    viewport: { width: 1350, height: 940 },
    network: {
      offline: false,
      downloadThroughput: (10 * 1024 * 1024) / 8,
      uploadThroughput: (10 * 1024 * 1024) / 8,
      latency: 40,
    },
    cpuThrottling: 1,
  },
};

const DEFAULT_URL = 'https://staging.eternity-uep.pages.dev/';
const DEFAULT_RUNS = 3;

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    runs: DEFAULT_RUNS,
    profile: 'mobile',
    json: false,
  };
  for (const raw of argv.slice(2)) {
    if (raw === '--json') {
      args.json = true;
      continue;
    }
    const match = /^--([^=]+)=(.*)$/.exec(raw);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'url') args.url = value;
    else if (key === 'runs') args.runs = Math.max(1, Number(value) || 1);
    else if (key === 'profile') args.profile = value;
  }
  return args;
}

/** 中位數——平均值會被單次冷啟動整個帶偏，這裡要的是典型值 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * 單次量測。每次都開新的 context——共用 context 會讓第二次之後吃到
 * HTTP 快取與已建立的連線，量到的是「回訪」而不是「初次載入」。
 */
async function measureOnce(browser, url, profile) {
  const context = await browser.newContext({ viewport: profile.viewport });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', profile.network);
  await cdp.send('Emulation.setCPUThrottlingRate', {
    rate: profile.cpuThrottling,
  });

  /* LCP 只能靠 PerformanceObserver 取得，而且必須在文件開始載入前就註冊，
     否則早期的 entry 收不到。addInitScript 會在每個 document 建立時執行。 */
  await page.addInitScript(() => {
    window.__perf = { lcp: null, lcpUrl: null };
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (!last) return;
        window.__perf.lcp = last.startTime;
        window.__perf.lcpUrl = last.url || null;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      /* 不支援就留 null，其餘指標照常 */
    }
  });

  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  /* LCP 會隨著後續繪製往後更新，載入完成後再等一段讓它收斂 */
  await page.waitForTimeout(2500);

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paints = performance.getEntriesByType('paint');
    const fcp = paints.find((p) => p.name === 'first-contentful-paint');
    const resources = performance.getEntriesByType('resource');
    const sum = (list) =>
      list.reduce((acc, r) => acc + (r.encodedBodySize || 0), 0);
    const byExt = (...exts) =>
      resources.filter((r) => {
        const path = r.name.split('?')[0];
        return exts.some((ext) => path.endsWith(ext));
      });

    const fonts = byExt('.woff2', '.woff', '.ttf');
    const images = byExt('.webp', '.png', '.jpg', '.jpeg', '.svg');

    return {
      ttfb: nav ? nav.responseStart : null,
      fcp: fcp ? fcp.startTime : null,
      lcp: window.__perf?.lcp ?? null,
      lcpUrl: window.__perf?.lcpUrl ?? null,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
      load: nav ? nav.loadEventEnd : null,
      htmlKB: nav ? nav.encodedBodySize / 1024 : null,
      requests: resources.length,
      jsKB: sum(byExt('.js')) / 1024,
      jsCount: byExt('.js').length,
      cssKB: sum(byExt('.css')) / 1024,
      cssCount: byExt('.css').length,
      fontKB: sum(fonts) / 1024,
      fontCount: fonts.length,
      imgKB: sum(images) / 1024,
      imgCount: images.length,
      /* 跨網域資源若沒有 Timing-Allow-Origin，encodedBodySize 一律是 0——
         Google Fonts 的字型檔就是這種情況。大小量不到時至少要能看出
         「抓了幾個」，否則 0 KB 會被誤讀成「根本沒下載」。 */
      crossOriginOpaque: resources.filter(
        (r) => r.encodedBodySize === 0 && r.duration > 0
      ).length,
    };
  });

  await context.close();
  return metrics;
}

async function main() {
  const args = parseArgs(process.argv);
  const profile = PROFILES[args.profile];
  if (!profile) {
    console.error(
      `未知的 profile：${args.profile}（可用：${Object.keys(PROFILES).join(' / ')}）`
    );
    process.exit(1);
  }

  if (!args.json) {
    console.log(`\n量測目標：${args.url}`);
    console.log(`節流設定：${profile.label}`);
    console.log(`執行次數：${args.runs}（取中位數）\n`);
  }

  const browser = await chromium.launch();
  const runs = [];
  try {
    for (let i = 0; i < args.runs; i += 1) {
      const result = await measureOnce(browser, args.url, profile);
      runs.push(result);
      if (!args.json) {
        console.log(
          `  第 ${i + 1} 次  TTFB ${Math.round(result.ttfb)}ms · ` +
            `FCP ${Math.round(result.fcp ?? 0)}ms · ` +
            `LCP ${Math.round(result.lcp ?? 0)}ms`
        );
      }
    }
  } finally {
    await browser.close();
  }

  const pick = (key) =>
    median(runs.map((r) => r[key]).filter((v) => typeof v === 'number'));

  const summary = {
    url: args.url,
    profile: args.profile,
    runs: args.runs,
    ttfb: pick('ttfb'),
    fcp: pick('fcp'),
    lcp: pick('lcp'),
    lcpUrl: runs[runs.length - 1]?.lcpUrl ?? null,
    domContentLoaded: pick('domContentLoaded'),
    load: pick('load'),
    htmlKB: pick('htmlKB'),
    requests: pick('requests'),
    jsKB: pick('jsKB'),
    jsCount: pick('jsCount'),
    cssKB: pick('cssKB'),
    cssCount: pick('cssCount'),
    fontKB: pick('fontKB'),
    fontCount: pick('fontCount'),
    imgKB: pick('imgKB'),
    imgCount: pick('imgCount'),
    crossOriginOpaque: pick('crossOriginOpaque'),
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const kb = (n) => `${Math.round(n)} KB`;
  const res = (count, size) =>
    size > 0 ? `${count} 個 · ${kb(size)}` : `${count} 個 · 大小不可見`;

  console.log('\n──────── 中位數 ────────');
  console.log(`  TTFB              ${summary.ttfb} ms`);
  console.log(`  FCP               ${summary.fcp} ms`);
  console.log(`  LCP               ${summary.lcp} ms`);
  console.log(`  DOMContentLoaded  ${summary.domContentLoaded} ms`);
  console.log(`  Load              ${summary.load} ms`);
  console.log('  ── 資源 ──');
  console.log(`  請求數            ${summary.requests}`);
  console.log(`  HTML              ${kb(summary.htmlKB)}`);
  console.log(`  JS                ${res(summary.jsCount, summary.jsKB)}`);
  console.log(`  CSS               ${res(summary.cssCount, summary.cssKB)}`);
  console.log(`  字型              ${res(summary.fontCount, summary.fontKB)}`);
  console.log(`  圖片              ${res(summary.imgCount, summary.imgKB)}`);
  if (summary.crossOriginOpaque > 0) {
    console.log(
      `\n  ※ ${summary.crossOriginOpaque} 個跨網域資源量不到大小` +
        '（缺 Timing-Allow-Origin，多半是 Google Fonts）'
    );
  }
  if (summary.lcpUrl) console.log(`  LCP 元素：${summary.lcpUrl}`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
