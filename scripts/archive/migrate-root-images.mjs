#!/usr/bin/env node
/**
 * 遷移主站圖片到 ROOT_ASSETS_BUCKET (R2)
 *
 * 掃描 apps/root/public/images/ 下所有圖片，
 * 上傳到本地 Worker 的 /api/root/assets 端點。
 *
 * R2 key 保留原始目錄結構：images/projects/xxx/image.png
 *
 * 用法：
 *   node scripts/migrate-root-images.mjs           # dry-run
 *   node scripts/migrate-root-images.mjs --write    # 實際上傳
 *   node scripts/migrate-root-images.mjs --remote   # 上傳到遠端（需要 JWT）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'apps', 'root', 'public');

const args = process.argv.slice(2);
const dryRun = !args.includes('--write');
const remote = args.includes('--remote');

const API_BASE = remote
  ? 'https://eternity-content-api.ptyc4076.workers.dev'
  : 'http://localhost:8788';

// MIME type 對照
const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 遞迴掃描檔案
function walkDir(dir, base = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, rel));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (MIME_MAP[ext]) {
        results.push({ fullPath: full, key: `images/${rel}`, ext });
      }
    }
  }
  return results;
}

async function getToken() {
  if (!remote) return '';
  // 遠端需要 JWT
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  const username = await ask('Username: ');
  const password = await ask('Password: ');
  rl.close();

  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Login failed: ${json.error}`);
  return json.data.token;
}

async function main() {
  if (!fs.existsSync(ROOT_DIR)) {
    console.error(`Directory not found: ${ROOT_DIR}`);
    process.exit(1);
  }

  const files = walkDir(ROOT_DIR);
  console.log(`\n📁 Found ${files.length} images in apps/root/public/images/`);
  console.log(`🎯 Target: ${API_BASE}/api/root/assets`);
  console.log(
    `📝 Mode: ${dryRun ? 'DRY RUN (add --write to upload)' : 'WRITE'}\n`
  );

  if (dryRun) {
    for (const f of files) {
      const size = fs.statSync(f.fullPath).size;
      const sizeStr =
        size < 1024
          ? `${size}B`
          : size < 1024 * 1024
            ? `${(size / 1024).toFixed(1)}KB`
            : `${(size / (1024 * 1024)).toFixed(1)}MB`;
      console.log(`  ${f.key} (${sizeStr})`);
    }
    console.log(`\nTotal: ${files.length} files. Run with --write to upload.`);
    return;
  }

  let token = '';
  try {
    token = await getToken();
  } catch (e) {
    console.error(`Auth failed: ${e.message}`);
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;

  for (const f of files) {
    try {
      const fileBuffer = fs.readFileSync(f.fullPath);
      const mime = MIME_MAP[f.ext] || 'application/octet-stream';
      const blob = new Blob([fileBuffer], { type: mime });

      const formData = new FormData();
      formData.append('file', blob, path.basename(f.fullPath));
      formData.append('key', f.key);

      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/root/assets`, {
        method: 'POST',
        headers,
        body: formData,
      });

      const json = await res.json();
      if (json.ok) {
        ok++;
        console.log(`  ✅ ${f.key}`);
      } else {
        fail++;
        console.log(`  ❌ ${f.key} — ${json.error}`);
      }
    } catch (e) {
      fail++;
      console.log(`  ❌ ${f.key} — ${e.message}`);
    }
  }

  console.log(`\nDone: ${ok} uploaded, ${fail} failed.`);
}

main().catch(console.error);
