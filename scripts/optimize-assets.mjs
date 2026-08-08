#!/usr/bin/env node
/**
 * R2 資產瘦身：把過大的素材轉成輕量格式，並同步更新 D1 的引用。
 *
 * 兩條轉換路線：
 *   GIF → MP4（H.264）   內容中的 <img> 一併改寫為 <video autoplay loop muted playsinline>
 *   PNG/JPEG → WebP      標籤不變，只換 src
 *
 * ⚠️ 內容中的 <video> 需要 apps/root 的 TipTap video node（VideoNode.ts）才不會在
 * admin 存檔時被剝離。動 GIF 之前務必確認該 extension 已上線。
 *
 * 用法：
 *   node scripts/optimize-assets.mjs --dry-run          # 只列出計畫，不寫入
 *   node scripts/optimize-assets.mjs                    # 實際執行（會先確認）
 *   node scripts/optimize-assets.mjs --min-size=300     # 只處理超過 300KB 的
 *   node scripts/optimize-assets.mjs --yes              # 跳過確認
 *
 * 冪等：已經是 mp4/webp 的資產不會再被處理。
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveWriteToken, getAuthHeaders } from './sync-auth.mjs';
import { ask } from './sync-utils.mjs';
import {
  normalizeKey,
  assetPath,
  collectKeys,
  planFor,
  rewriteHtml,
} from './optimize-assets-utils.mjs';

const REMOTE_API = 'https://eternity-content-api.ptyc4076.workers.dev';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const AUTO_YES = args.includes('--yes');
const MIN_SIZE_KB = Number(
  args.find((a) => a.startsWith('--min-size='))?.split('=')[1] ?? 150
);
/**
 * 原檔備份目錄。
 *
 * R2 是這些素材唯一的存放處（public 下的舊副本已於 0.9.18.x 移除），而本腳本
 * 會在改寫引用後刪掉舊 key——刪掉就沒有第二份了。轉檔參數不理想、想重來，
 * 或轉出來的畫質不能接受時，都得靠這份備份。
 */
const BACKUP_DIR =
  args.find((a) => a.startsWith('--backup-dir='))?.split('=')[1] ??
  '.asset-backup';

/** 轉檔後的體積必須小於原檔的這個比例才值得換，否則徒增一次遷移風險 */
const WORTH_IT_RATIO = 0.9;

const KB = (n) => `${(n / 1024).toFixed(0)}KB`;
const assetUrl = (key) => `${REMOTE_API}${assetPath(key)}`;

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} 結束於 ${code}\n${stderr.slice(-800)}`))
    );
  });
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(
      `${init?.method || 'GET'} ${url} → ${res.status} ${json?.error || ''}`
    );
  }
  return json.data;
}

async function main() {
  console.log('\n🗜  R2 資產瘦身\n');
  console.log(`   目標  ${REMOTE_API}`);
  console.log(`   門檻  ${MIN_SIZE_KB}KB 以上`);
  if (DRY_RUN) console.log('   模式  DRY RUN（不會有任何寫入）');
  console.log('');

  await run('ffmpeg', ['-version']).catch(() => {
    throw new Error('找不到 ffmpeg，請先安裝並確認它在 PATH 上');
  });

  const projects = await fetchJson(`${REMOTE_API}/api/root/projects`);
  console.log(`   讀到 ${projects.length} 筆專案\n`);

  // 1. 收集所有引用並量測大小
  const jobs = [];
  for (const project of projects) {
    for (const [key, fields] of collectKeys(project)) {
      const res = await fetch(assetUrl(key), { method: 'HEAD' });
      if (!res.ok) {
        console.log(`   ⚠️  R2 找不到，略過： ${key}`);
        continue;
      }
      const size = Number(res.headers.get('content-length') || 0);
      const plan = planFor(key, size, MIN_SIZE_KB);
      if (!plan) continue;
      jobs.push({ project, key, size, fields, plan });
    }
  }

  if (jobs.length === 0) {
    console.log('   沒有需要處理的資產。\n');
    return;
  }

  console.log(`   ${jobs.length} 個資產待處理：\n`);
  for (const j of jobs) {
    console.log(
      `   ${j.plan.kind.padEnd(10)} ${KB(j.size).padStart(8)}  ${j.key}`
    );
    console.log(
      `   ${' '.repeat(20)}  ↳ ${j.project.id} · ${[...j.fields].join(', ')}`
    );
  }
  console.log('');

  if (DRY_RUN) {
    console.log('   DRY RUN 結束，未做任何變更。\n');
    return;
  }

  if (!AUTO_YES) {
    const answer = await ask('   確定執行？(yes/no): ', { lowercase: true });
    if (answer !== 'yes' && answer !== 'y') {
      console.log('   已取消。\n');
      return;
    }
  }

  const token = await resolveWriteToken({
    loginApiUrl: REMOTE_API,
    purpose: '資產轉檔與 D1 更新',
  });
  if (!token) {
    console.error('   [ERROR] 未取得授權，中止。\n');
    process.exitCode = 1;
    return;
  }
  const auth = getAuthHeaders(token);

  const workDir = await mkdtemp(path.join(tmpdir(), 'eternity-assets-'));
  const done = [];
  const skipped = [];
  const failed = [];

  try {
    for (const job of jobs) {
      const { key, plan, size, project } = job;
      try {
        // 2. 下載 → 轉檔
        const input = path.join(workDir, 'in' + path.extname(key));
        const output = path.join(workDir, 'out' + path.extname(plan.newKey));
        const buf = Buffer.from(
          await (await fetch(assetUrl(key))).arrayBuffer()
        );
        await writeFile(input, buf);

        // 備份原檔後才動它——R2 是唯一的一份，刪掉就回不來了
        const backupPath = path.join(BACKUP_DIR, key);
        await mkdir(path.dirname(backupPath), { recursive: true });
        await writeFile(backupPath, buf);

        await run('ffmpeg', plan.ffmpegArgs(input, output));
        const outBuf = await readFile(output);

        // 3. 沒有明顯變小就不換——每次遷移都是一次出錯的機會
        if (outBuf.length > size * WORTH_IT_RATIO) {
          console.log(
            `   ⏭  ${key}\n      ${KB(size)} → ${KB(outBuf.length)}，效益不足，略過`
          );
          skipped.push(key);
          continue;
        }

        // 4. 上傳新資產
        const form = new FormData();
        form.set(
          'file',
          new File([outBuf], path.basename(plan.newKey), {
            type: plan.contentType,
          })
        );
        form.set('key', plan.newKey);
        await fetchJson(`${REMOTE_API}/api/root/assets`, {
          method: 'POST',
          headers: auth,
          body: form,
        });

        // 5. 更新 D1 引用（只送有變動的欄位，PUT 是部分更新）
        const toVideo = plan.contentType.startsWith('video/');
        const patch = {};
        // image 欄位是縮圖，放不了影片——轉影片時維持原狀，靠 content 那份省體積
        if (normalizeKey(project.image || '') === key && !toVideo) {
          patch.image = plan.newKey;
        }
        for (const field of ['contentZh', 'contentEn']) {
          const result = rewriteHtml(project[field], key, plan.newKey, toVideo);
          if (result.changed > 0) patch[field] = result.html;
        }

        if (Object.keys(patch).length > 0) {
          await fetchJson(`${REMOTE_API}/api/root/projects/${project.id}`, {
            method: 'PUT',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
        }

        // 6. 舊資產只在確定沒有引用殘留時才刪。
        //    唯一會殘留的情況是 GIF→MP4 而該 GIF 同時是 image 縮圖：
        //    縮圖欄位放不了影片，patch.image 因此沒設，舊檔還有人用。
        const imageStillPointsToOld =
          normalizeKey(project.image || '') === key && !patch.image;

        if (imageStillPointsToOld) {
          console.log(`   ℹ  ${key} 仍是 image 縮圖，保留舊檔`);
        } else {
          await fetchJson(`${REMOTE_API}/api/root/assets/batch`, {
            method: 'DELETE',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: [key] }),
          });
        }

        console.log(
          `   ✓ ${plan.kind}  ${KB(size)} → ${KB(outBuf.length)}  (省 ${(100 - (outBuf.length / size) * 100).toFixed(0)}%)  ${key}`
        );
        done.push({ key, before: size, after: outBuf.length });
      } catch (e) {
        console.log(`   ✗ ${key}\n      ${e.message}`);
        failed.push({ key, error: e.message });
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const before = done.reduce((a, d) => a + d.before, 0);
  const after = done.reduce((a, d) => a + d.after, 0);
  console.log(
    `\n   完成 ${done.length}／略過 ${skipped.length}／失敗 ${failed.length}`
  );
  if (done.length) {
    console.log(
      `   總量 ${KB(before)} → ${KB(after)}  (省 ${(100 - (after / before) * 100).toFixed(0)}%)\n`
    );
  }
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`\n[ERROR] ${e.message}\n`);
  process.exitCode = 1;
});
