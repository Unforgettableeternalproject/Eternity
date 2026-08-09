#!/usr/bin/env node
/**
 * 統一同步入口 — 選擇站點後執行對應同步腳本
 *
 * Usage:
 *   pnpm sync                        # 互動選擇站點
 *   pnpm sync --site docs [...]      # 直接同步文件站 (UEP)
 *   pnpm sync --site root [...]      # 直接同步主站
 *   pnpm sync --site all [...]       # 兩站都同步
 *
 * 所有額外參數 (--push, --pull, --dry-run 等) 會傳遞給對應腳本。
 * 非 dry-run 模式下，此腳本統一完成登入，透過 SYNC_REMOTE_TOKEN 環境變數
 * 傳遞給子腳本，避免多站同步時重複詢問密碼。
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { ask, checkLocalApi, checkRemoteApi } from './sync-utils.mjs';
import { resolveWriteToken } from './sync-auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOCAL_API = 'http://localhost:8788';
const REMOTE_API = 'https://eternity-content-api.ptyc4076.workers.dev';

const SCRIPTS = {
  docs: path.join(__dirname, 'sync-content.mjs'),
  root: path.join(__dirname, 'sync-root.mjs'),
};

// 解析 --site 旗標，並從傳遞參數中移除
const rawArgs = process.argv.slice(2);
const siteIdx = rawArgs.indexOf('--site');
let site = null;
const passArgs = [...rawArgs];

if (siteIdx !== -1 && rawArgs[siteIdx + 1]) {
  site = rawArgs[siteIdx + 1].toLowerCase();
  passArgs.splice(siteIdx, 2);
}

const DRY_RUN = passArgs.includes('--dry-run');

/**
 * 執行子腳本，傳入環境變數（含 SYNC_REMOTE_TOKEN）
 * @param {string} scriptPath 腳本路徑
 * @param {string[]} args 傳遞的參數
 * @param {Record<string, string>} env 額外環境變數
 */
function runScript(scriptPath, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, ...env },
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`腳本結束代碼 ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  console.log();
  console.log('╔══════════════════════════════════════╗');
  console.log('║     Eternity — 內容同步工具          ║');
  console.log('╚══════════════════════════════════════╝');
  console.log();

  // 本地 API 健檢（dry-run 也需要讀取資料，所以一律檢查）
  const localOk = await checkLocalApi(LOCAL_API);
  if (!localOk) {
    console.error(
      '❌ 無法連線到本地 content-api (localhost:8788)，請確認 dev server 正在運行：'
    );
    console.error('   pnpm --filter content-api-worker dev\n');
    process.exit(1);
  }

  // 遠端 API 健檢
  const remoteStatus = await checkRemoteApi(REMOTE_API);
  if (remoteStatus === 'unreachable') {
    console.error('❌ 無法連線到遠端 API，請確認網路連線\n');
    process.exit(1);
  }
  if (remoteStatus === 'bad_format') {
    console.error(
      '⚠️  遠端 API 回傳非 JSON 格式（可能是 Cloudflare 錯誤頁面）\n'
    );
  }

  // 非 dry-run 時統一取得授權，token 傳給子腳本。
  // 設了 API_TOKEN 環境變數就直接用，沒有才互動登入
  let syncToken = '';
  if (!DRY_RUN) {
    const token = await resolveWriteToken({
      loginApiUrl: REMOTE_API,
      purpose: '同步',
    });
    if (!token) {
      console.error('❌ 認證失敗，無法繼續同步\n');
      process.exit(1);
    }
    syncToken = token;
  }

  // 決定同步站點
  if (!site) {
    console.log('  選擇要同步的站點：');
    console.log();
    console.log('    [1] 📚 文件站 (UEP Imaginary Space)');
    console.log('    [2] 🏠 主站   (unforgettableeternalproject.com)');
    console.log('    [3] 🔄 全部   (兩站都同步)');
    console.log();
    const answer = await ask('  請輸入 (1/2/3): ');

    if (answer === '1' || answer === 'docs') site = 'docs';
    else if (answer === '2' || answer === 'root') site = 'root';
    else if (answer === '3' || answer === 'all') site = 'all';
    else {
      console.log('  ⏭ 取消');
      return;
    }
  }

  const targets = site === 'all' ? ['docs', 'root'] : [site];
  // 傳給子腳本的額外環境變數
  const childEnv = syncToken ? { SYNC_REMOTE_TOKEN: syncToken } : {};

  for (const target of targets) {
    if (!SCRIPTS[target]) {
      console.error(`  ❌ 未知站點: ${target}`);
      continue;
    }

    if (targets.length > 1) {
      console.log();
      console.log('━'.repeat(50));
      console.log(`  ${target === 'docs' ? '📚 文件站' : '🏠 主站'} 同步開始`);
      console.log('━'.repeat(50));
    }

    try {
      await runScript(SCRIPTS[target], passArgs, childEnv);
    } catch (e) {
      console.error(`  ❌ ${target} 同步失敗:`, e.message);
      if (targets.length > 1) {
        const cont = await ask('  繼續下一站？ [y/n]: ');
        if (cont !== 'y') break;
      }
    }
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
