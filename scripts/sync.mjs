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
 */

import { execSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRIPTS = {
  docs: path.join(__dirname, 'sync-content.mjs'),
  root: path.join(__dirname, 'sync-root.mjs'),
};

// Parse --site flag, remove it from passthrough args
const rawArgs = process.argv.slice(2);
const siteIdx = rawArgs.indexOf('--site');
let site = null;
const passArgs = [...rawArgs];

if (siteIdx !== -1 && rawArgs[siteIdx + 1]) {
  site = rawArgs[siteIdx + 1].toLowerCase();
  passArgs.splice(siteIdx, 2);
}

function ask(question, options) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function runScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Script exited with code ${code}`));
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

  // Determine site
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
      await runScript(SCRIPTS[target], passArgs);
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
