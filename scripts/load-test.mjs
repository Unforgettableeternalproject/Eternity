#!/usr/bin/env node
/**
 * 負載測試腳本 — 對主站和 content-api 發送並行請求
 *
 * 用法：
 *   node scripts/load-test.mjs                          # 測試本地
 *   node scripts/load-test.mjs --target staging         # 測試 staging
 *   node scripts/load-test.mjs --target production      # 測試 production
 *   node scripts/load-test.mjs --concurrency 50 --rounds 5
 */

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const TARGET = getArg('target', 'local');
const CONCURRENCY = parseInt(getArg('concurrency', '20'), 10);
const ROUNDS = parseInt(getArg('rounds', '3'), 10);

// ── 目標 URL ──────────────────────────────────
const TARGETS = {
  local: {
    site: 'http://localhost:4320',
    api: 'http://localhost:8788',
  },
  staging: {
    site: 'https://staging-root.pages.dev',
    api: 'https://eternity-content-api.ptyc4076.workers.dev',
  },
  production: {
    site: 'https://unforgettableeternalproject.com',
    api: 'https://eternity-content-api.ptyc4076.workers.dev',
  },
};

const target = TARGETS[TARGET];
if (!target) {
  console.error(`未知目標: ${TARGET}，可用: local, staging, production`);
  process.exit(1);
}

console.log(`\n🔥 負載測試`);
console.log(`   目標: ${TARGET} (${target.site})`);
console.log(`   並行: ${CONCURRENCY}`);
console.log(`   輪數: ${ROUNDS}\n`);

// ── 測試端點 ──────────────────────────────────
const SSR_PAGES = [
  '/',
  '/zh-tw/',
  '/zh-tw/about',
  '/zh-tw/projects',
  '/zh-tw/updates',
  '/zh-tw/links',
  '/zh-tw/contact',
  '/en/',
  '/en/about',
];

const API_ENDPOINTS = [
  '/api/root/projects',
  '/api/root/links',
  '/api/root/updates',
  '/api/root/singletons/about-zh',
  '/api/root/cards/card-quote',
  '/api/root/cards/card-music',
  '/api/root/cards/card-status',
];

// ── 工具函式 ──────────────────────────────────

async function timedFetch(url) {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/html,application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const elapsed = performance.now() - start;
    // 消耗 body 避免連線佔用
    await res.text();
    return { url, status: res.status, ms: Math.round(elapsed), ok: true };
  } catch (e) {
    const elapsed = performance.now() - start;
    return {
      url,
      status: 0,
      ms: Math.round(elapsed),
      ok: false,
      error: e.message,
    };
  }
}

function stats(results) {
  const times = results.filter((r) => r.ok).map((r) => r.ms);
  if (times.length === 0) return { count: 0, ok: 0, fail: results.length };

  times.sort((a, b) => a - b);
  return {
    count: results.length,
    ok: times.length,
    fail: results.length - times.length,
    min: times[0],
    max: times[times.length - 1],
    avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    p50: times[Math.floor(times.length * 0.5)],
    p95: times[Math.floor(times.length * 0.95)],
    p99: times[Math.floor(times.length * 0.99)],
  };
}

function printStats(label, s) {
  if (s.count === 0) {
    console.log(`  ${label}: 無資料`);
    return;
  }
  const failStr = s.fail > 0 ? ` ❌ ${s.fail} 失敗` : '';
  console.log(
    `  ${label}: ${s.count} 請求, avg=${s.avg}ms, p50=${s.p50}ms, p95=${s.p95}ms, p99=${s.p99}ms, min=${s.min}ms, max=${s.max}ms${failStr}`
  );
}

// ── 測試執行 ──────────────────────────────────

async function runBatch(label, baseUrl, paths, concurrency) {
  console.log(`\n── ${label} ──`);
  const allResults = [];

  for (let round = 1; round <= ROUNDS; round++) {
    // 從 paths 中隨機選取 concurrency 個 URL
    const urls = Array.from({ length: concurrency }, () => {
      const path = paths[Math.floor(Math.random() * paths.length)];
      return `${baseUrl}${path}`;
    });

    const results = await Promise.all(urls.map(timedFetch));
    allResults.push(...results);

    const s = stats(results);
    console.log(
      `  第 ${round}/${ROUNDS} 輪: avg=${s.avg}ms, p95=${s.p95}ms, fail=${s.fail}`
    );
  }

  const total = stats(allResults);
  printStats('總計', total);

  return { label, stats: total, results: allResults };
}

async function main() {
  const startTime = Date.now();

  // 暖機：先各打一次
  console.log('⏳ 暖機中...');
  await Promise.all([
    fetch(`${target.site}/zh-tw/`)
      .then((r) => r.text())
      .catch(() => {}),
    fetch(`${target.api}/api/root/projects`)
      .then((r) => r.text())
      .catch(() => {}),
  ]);

  // SSR 頁面壓力
  const ssrResult = await runBatch(
    'SSR 頁面',
    target.site,
    SSR_PAGES,
    CONCURRENCY
  );

  // API 端點壓力
  const apiResult = await runBatch(
    'API 端點',
    target.api,
    API_ENDPOINTS,
    CONCURRENCY
  );

  // ── 結果總結 ──────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 負載測試結果（${elapsed}s）`);
  console.log(`${'═'.repeat(60)}`);
  printStats('SSR 頁面', ssrResult.stats);
  printStats('API 端點', apiResult.stats);

  // 失敗的請求
  const allFailed = [...ssrResult.results, ...apiResult.results].filter(
    (r) => !r.ok
  );
  if (allFailed.length > 0) {
    console.log(`\n⚠️  失敗的請求 (${allFailed.length}):`);
    for (const f of allFailed.slice(0, 10)) {
      console.log(`  ${f.url} — ${f.error} (${f.ms}ms)`);
    }
  }

  // 判定是否通過
  const ssrPass = ssrResult.stats.p95 < 5000 && ssrResult.stats.fail === 0;
  const apiPass = apiResult.stats.p95 < 2000 && apiResult.stats.fail === 0;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`SSR p95 < 5000ms: ${ssrPass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`API p95 < 2000ms: ${apiPass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`${'─'.repeat(60)}\n`);

  if (!ssrPass || !apiPass) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('負載測試失敗:', e);
  process.exit(1);
});
